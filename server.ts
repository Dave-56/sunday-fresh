import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

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
