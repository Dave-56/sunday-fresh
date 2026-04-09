import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  selectCandidateWithRerank,
  type SelectionResult,
} from "./api/_lib/candidateSelector.ts";
import { classifyIngredientClass } from "./api/_lib/ingredientSignals.ts";
import type {
  ProductCandidate,
  StructuredIngredientIntent,
} from "./api/_lib/matchScorer.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Kroger API helpers
// ---------------------------------------------------------------------------
const KROGER_API_BASE = "https://api.kroger.com/v1";
const KROGER_AUTH_URL = `${KROGER_API_BASE}/connect/oauth2`;
const KROGER_CLIENT_ID = process.env.KROGER_CLIENT_ID || "";
const KROGER_CLIENT_SECRET = process.env.KROGER_CLIENT_SECRET || "";
const KROGER_REDIRECT_URI = process.env.KROGER_REDIRECT_URI || "http://localhost:3000/api/kroger/auth/callback";

function krogerBasicAuth(): string {
  return Buffer.from(`${KROGER_CLIENT_ID}:${KROGER_CLIENT_SECRET}`).toString("base64");
}

// In-memory token stores (MVP — replace with DB/session in production)
let clientToken: { access_token: string; expires_at: number } | null = null;

// Per-session user tokens keyed by a simple session id
const userTokens = new Map<string, {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}>();

function generateSessionId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface RerankRequestBody {
  ingredient: StructuredIngredientIntent;
  candidates: ProductCandidate[];
}

function isStructuredIngredientIntent(value: unknown): value is StructuredIngredientIntent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.display === "string" &&
    typeof v.item === "string" &&
    Array.isArray(v.searchTerms) &&
    v.searchTerms.every((s) => typeof s === "string") &&
    typeof v.qty === "number" &&
    (v.qtyMode === "container" || v.qtyMode === "unit-count" || v.qtyMode === "single-pack")
  );
}

function isProductCandidate(value: unknown): value is ProductCandidate {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.upc === "string" &&
    typeof v.description === "string" &&
    typeof v.brand === "string"
  );
}

function isRerankBody(value: unknown): value is RerankRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    isStructuredIngredientIntent(v.ingredient) &&
    Array.isArray(v.candidates) &&
    v.candidates.every(isProductCandidate)
  );
}

function parseEnabledEnv(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function parseTimeoutMs(value: string | undefined): number {
  const raw = Number.parseInt(value || "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return 7000;
  return Math.min(Math.max(raw, 1000), 15000);
}

const DEBUG_RERANK_LOGS = (() => {
  const raw = String(process.env.RERANK_DEBUG_LOGS || "").toLowerCase();
  return raw === "1" || raw === "true";
})();

function createRequestId(existing?: string | string[]): string {
  if (typeof existing === "string" && existing.trim()) return existing.trim();
  const rand = Math.random().toString(36).slice(2, 8);
  return `rerank_${Date.now()}_${rand}`;
}

function logRerankDebug(event: string, payload: Record<string, unknown>): void {
  if (!DEBUG_RERANK_LOGS) return;
  const logPayload = {
    scope: "kroger_rerank_endpoint",
    event,
    ts: new Date().toISOString(),
    ...payload,
  };
  console.log(`[kroger-rerank-endpoint] ${JSON.stringify(logPayload)}`);
}

async function getClientToken(): Promise<string> {
  if (clientToken && Date.now() < clientToken.expires_at) {
    return clientToken.access_token;
  }

  const res = await fetch(`${KROGER_AUTH_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${krogerBasicAuth()}`,
    },
    body: "grant_type=client_credentials&scope=product.compact",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kroger client token failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  clientToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000, // 1 min buffer
  };
  return clientToken.access_token;
}

async function refreshUserToken(sessionId: string): Promise<string> {
  const session = userTokens.get(sessionId);
  if (!session) throw new Error("No session found");

  const res = await fetch(`${KROGER_AUTH_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${krogerBasicAuth()}`,
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refresh_token)}`,
  });

  if (!res.ok) {
    userTokens.delete(sessionId);
    throw new Error("Refresh token expired — user must re-authenticate");
  }

  const data = await res.json();
  userTokens.set(sessionId, {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
  });
  return data.access_token;
}

async function getUserToken(sessionId: string): Promise<string> {
  const session = userTokens.get(sessionId);
  if (!session) throw new Error("Not authenticated with Kroger");
  if (Date.now() < session.expires_at) return session.access_token;
  return refreshUserToken(sessionId);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // =========================================================================
  // Kroger API Routes
  // =========================================================================

  // --- OAuth: Start login flow (Authorization Code) ---
  app.get("/api/kroger/auth/login", (req, res) => {
    const scopes = "cart.basic:write product.compact profile.compact";
    const authorizeUrl =
      `${KROGER_AUTH_URL}/authorize?` +
      `scope=${encodeURIComponent(scopes)}` +
      `&response_type=code` +
      `&client_id=${encodeURIComponent(KROGER_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(KROGER_REDIRECT_URI)}`;
    res.json({ url: authorizeUrl });
  });

  // --- OAuth: Callback (exchange code for tokens) ---
  app.get("/api/kroger/auth/callback", async (req, res) => {
    const code = req.query.code as string;
    if (!code) return res.status(400).send("Missing authorization code");

    try {
      const tokenRes = await fetch(`${KROGER_AUTH_URL}/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${krogerBasicAuth()}`,
        },
        body:
          `grant_type=authorization_code` +
          `&code=${encodeURIComponent(code)}` +
          `&redirect_uri=${encodeURIComponent(KROGER_REDIRECT_URI)}`,
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        return res.status(tokenRes.status).send(`Token exchange failed: ${text}`);
      }

      const data = await tokenRes.json();
      const sessionId = generateSessionId();
      userTokens.set(sessionId, {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000 - 60_000,
      });

      // Redirect back to the app with the session ID
      res.redirect(`/?kroger_session=${sessionId}`);
    } catch (err: any) {
      res.status(500).send(`OAuth error: ${err.message}`);
    }
  });

  // --- Auth status check ---
  app.get("/api/kroger/auth/status", (req, res) => {
    const sessionId = req.query.session as string;
    if (!sessionId || !userTokens.has(sessionId)) {
      return res.json({ authenticated: false });
    }
    res.json({ authenticated: true });
  });

  // --- Locations: Search stores by zip code ---
  app.get("/api/kroger/locations", async (req, res) => {
    try {
      const token = await getClientToken();
      const zip = req.query.zip as string;
      const limit = req.query.limit || "5";
      const url = `${KROGER_API_BASE}/locations?filter.zipCode.near=${zip}&filter.limit=${limit}`;

      const apiRes = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });

      if (!apiRes.ok) {
        const text = await apiRes.text();
        return res.status(apiRes.status).json({ error: text });
      }

      const data = await apiRes.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Products: Search by term (with optional locationId for pricing) ---
  app.get("/api/kroger/products/search", async (req, res) => {
    try {
      const token = await getClientToken();
      const term = req.query.term as string;
      const locationId = req.query.locationId as string;
      const limit = req.query.limit || "5";

      let url = `${KROGER_API_BASE}/products?filter.term=${encodeURIComponent(term)}&filter.limit=${limit}`;
      if (locationId) url += `&filter.locationId=${locationId}`;

      const apiRes = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });

      if (!apiRes.ok) {
        const text = await apiRes.text();
        return res.status(apiRes.status).json({ error: text });
      }

      const data = await apiRes.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Products: LLM rerank candidates ---
  app.post("/api/kroger/products/rerank", async (req, res) => {
    const requestId = createRequestId(req.headers["x-request-id"]);
    try {
      const body = req.body as unknown;
      if (!isRerankBody(body)) {
        logRerankDebug("request.invalid_body", {
          requestId,
          bodyType: typeof body,
        });
        return res.status(400).json({ error: "Invalid rerank payload" });
      }

      const llmEnabled = parseEnabledEnv(process.env.ENABLE_LLM_RERANK_WEB);
      const llmTimeoutMs = parseTimeoutMs(process.env.LLM_RERANK_TIMEOUT_MS);
      logRerankDebug("request.received", {
        requestId,
        llmEnabled,
        llmTimeoutMs,
        ingredientClass: classifyIngredientClass(body.ingredient),
        ingredient: body.ingredient,
        candidateCount: body.candidates.length,
        candidates: body.candidates,
      });
      const result: SelectionResult = await selectCandidateWithRerank(
        body.ingredient,
        body.candidates,
        {
          enableLlm: llmEnabled,
          llmTimeoutMs,
          requestId,
        }
      );
      logRerankDebug("request.completed", {
        requestId,
        result,
      });

      return res.json(result);
    } catch (err: any) {
      logRerankDebug("request.failed", {
        requestId,
        error: err?.message || String(err),
      });
      return res.status(500).json({ error: err.message || "Rerank failed" });
    }
  });

  // --- Cart: Add items (requires user auth) ---
  app.post("/api/kroger/cart/add", async (req, res) => {
    try {
      const sessionId = req.query.session as string;
      if (!sessionId) return res.status(401).json({ error: "Missing session" });

      const token = await getUserToken(sessionId);
      const { items } = req.body; // [{ upc: string, quantity: number }]

      const apiRes = await fetch(`${KROGER_API_BASE}/cart/add`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ items }),
      });

      if (!apiRes.ok) {
        const text = await apiRes.text();
        return res.status(apiRes.status).json({ error: text });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Profile: Get user info (requires user auth) ---
  app.get("/api/kroger/profile", async (req, res) => {
    try {
      const sessionId = req.query.session as string;
      if (!sessionId) return res.status(401).json({ error: "Missing session" });

      const token = await getUserToken(sessionId);
      const apiRes = await fetch(`${KROGER_API_BASE}/identity/profile`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });

      if (!apiRes.ok) {
        const text = await apiRes.text();
        return res.status(apiRes.status).json({ error: text });
      }

      const data = await apiRes.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // Vite / Static serving
  // =========================================================================

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
