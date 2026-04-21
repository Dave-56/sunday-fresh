// Kroger API client — calls our backend proxy routes

const KROGER_SESSION_KEY = "kroger_session";

export function getKrogerSession(): string | null {
  return localStorage.getItem(KROGER_SESSION_KEY);
}

export function setKrogerSession(sessionId: string) {
  localStorage.setItem(KROGER_SESSION_KEY, sessionId);
}

export function clearKrogerSession() {
  localStorage.removeItem(KROGER_SESSION_KEY);
}

export function isKrogerAuthenticated(): boolean {
  return !!getKrogerSession();
}

/** Get the Kroger OAuth login URL (opens in new tab) */
export async function getLoginUrl(): Promise<string> {
  const res = await fetch("/api/kroger/auth/login");
  const data = await res.json();
  return data.url;
}

/** Verify session is still valid */
export async function checkAuthStatus(): Promise<boolean> {
  const session = getKrogerSession();
  if (!session) return false;
  const res = await fetch(`/api/kroger/auth/status?session=${session}`);
  const data = await res.json();
  if (!data.authenticated) {
    clearKrogerSession();
    return false;
  }
  return true;
}

/** Search for Kroger stores near a zip code */
export async function searchLocations(zip: string): Promise<KrogerLocation[]> {
  const res = await fetch(`/api/kroger/locations?zip=${encodeURIComponent(zip)}&limit=5`);
  if (!res.ok) throw new Error("Failed to search locations");
  const data = await res.json();
  return (data.data || []).map((loc: any) => ({
    locationId: loc.locationId,
    name: loc.name,
    chain: loc.chain,
    address: loc.address,
  }));
}

/** Search for a product by name, optionally at a specific store */
export async function searchProducts(
  term: string,
  locationId?: string,
  limit = 5
): Promise<KrogerProduct[]> {
  let url = `/api/kroger/products/search?term=${encodeURIComponent(term)}&limit=${limit}`;
  if (locationId) url += `&locationId=${locationId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to search products");
  const data = await res.json();
  return (data.data || []).map((p: any) => {
    // Kroger only populates inventory / fulfillment on items[0] when
    // filter.locationId was passed. Missing data stays undefined and
    // classifyAvailability treats it as 'ok' downstream.
    const firstItem = Array.isArray(p.items) ? p.items[0] : undefined;
    const stockLevel = firstItem?.inventory?.stockLevel as KrogerStockLevel | undefined;
    const fulfillment = firstItem?.fulfillment as KrogerFulfillment | undefined;
    return {
      productId: p.productId,
      upc: p.upc,
      description: p.description,
      brand: p.brand,
      images: p.images,
      items: p.items,
      stockLevel,
      fulfillment,
    };
  });
}

export interface ProductRerankIngredientIntent {
  display: string;
  item: string;
  searchTerms: string[];
  forbiddenForms?: string[];
  qty: number;
  qtyMode: 'container' | 'unit-count' | 'single-pack';
}

export type KrogerStockLevel = 'HIGH' | 'LOW' | 'TEMPORARILY_OUT_OF_STOCK';

export interface KrogerFulfillment {
  inStore?: boolean;
  shipToHome?: boolean;
  delivery?: boolean;
  curbside?: boolean;
}

export interface ProductRerankCandidate {
  upc: string;
  description: string;
  brand: string;
  size?: string;
  soldBy?: string;
  countPerPack?: number;
  stockLevel?: KrogerStockLevel;
  fulfillment?: KrogerFulfillment;
}

export type AvailabilityTier = 'ok' | 'weak' | 'out';

export interface ProductRerankResponse {
  decision: 'select' | 'needs_review' | 'no_match';
  selectedUpc: string | null;
  backupUpc: string | null;
  availability: AvailabilityTier;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  metadata: {
    decisionSource: 'llm' | 'fallback' | 'deterministic';
    latencyMs: number;
    guardrailOverride?: string;
  };
}

export async function rerankProductSelection(
  ingredient: ProductRerankIngredientIntent,
  candidates: ProductRerankCandidate[],
  signal?: AbortSignal
): Promise<ProductRerankResponse> {
  const res = await fetch('/api/kroger/products/rerank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ingredient, candidates }),
    signal,
  });

  if (!res.ok) {
    let detail = `Failed to rerank product candidates (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) detail = String(data.error);
    } catch {
      // no-op: keep status-based fallback message
    }
    throw new Error(detail);
  }

  return res.json();
}

/** Add items to the user's Kroger cart */
export async function addToCart(
  items: { upc: string; quantity: number }[]
): Promise<boolean> {
  const session = getKrogerSession();
  if (!session) throw new Error("Not authenticated with Kroger");

  const res = await fetch(`/api/kroger/cart/add?session=${session}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to add to cart");
  }
  return true;
}

/** Get user profile */
export async function getProfile(): Promise<any> {
  const session = getKrogerSession();
  if (!session) throw new Error("Not authenticated with Kroger");
  const res = await fetch(`/api/kroger/profile?session=${session}`);
  if (!res.ok) throw new Error("Failed to get profile");
  return res.json();
}

// Kroger-family chain → storefront domain mapping
const CHAIN_DOMAINS: Record<string, { domain: string; name: string }> = {
  "QFC":            { domain: "qfc.com",              name: "QFC" },
  "FRED MEYER":     { domain: "fredmeyer.com",        name: "Fred Meyer" },
  "RALPHS":         { domain: "ralphs.com",           name: "Ralphs" },
  "HARRIS TEETER":  { domain: "harristeeter.com",     name: "Harris Teeter" },
  "KING SOOPERS":   { domain: "kingsoopers.com",      name: "King Soopers" },
  "FRY'S":          { domain: "frysfood.com",         name: "Fry's" },
  "SMITH'S":        { domain: "smithsfoodanddrug.com", name: "Smith's" },
  "DILLONS":        { domain: "dillons.com",          name: "Dillons" },
  "KROGER":         { domain: "kroger.com",           name: "Kroger" },
};

export function getChainInfo(chain: string): { domain: string; name: string; cartUrl: string } {
  const key = chain.toUpperCase();
  const info = CHAIN_DOMAINS[key] || { domain: "kroger.com", name: chain || "Kroger" };
  return { ...info, cartUrl: `https://www.${info.domain}/cart` };
}

// Types
export interface KrogerLocation {
  locationId: string;
  name: string;
  chain: string;
  address: {
    addressLine1: string;
    city: string;
    state: string;
    zipCode: string;
  };
}

export interface KrogerProduct {
  productId: string;
  upc: string;
  description: string;
  brand: string;
  images: any[];
  items: any[];
  /** Location-scoped stock signal from items[0].inventory.stockLevel, when present */
  stockLevel?: KrogerStockLevel;
  /** Location-scoped fulfillment flags from items[0].fulfillment, when present */
  fulfillment?: KrogerFulfillment;
}

export interface CartItem {
  name: string;        // display name (from our recipe/essentials)
  upc: string;         // Kroger UPC to add
  quantity: number;
  description: string; // Kroger product description
  brand: string;
}
