import { GoogleGenAI, Type } from '@google/genai';
import { redis } from './redis.js';
import { KV_KEYS } from './kvSchema.js';
import type { KVPreferences, KVPendingMeals } from './kvSchema.js';
import { buildDetailPrompt } from './buildPrompt.js';
import { getSearchTerms, getSearchTermsFromIntent } from './ingredients.js';
import { parseIngredient, shoppingToParsed, rankCandidatesForSelection, preFilterCandidates, type ProductCandidate } from './matchScorer.js';
import {
  getClientToken,
  getUserToken,
  deleteUserSession,
  KROGER_API_BASE,
} from './krogerServer.js';
import type { Dish, RecipeSection, ShoppingIngredient, IngredientMapping, EssentialItem } from './types.js';

function toProductCandidate(product: any): ProductCandidate {
  const firstItem = Array.isArray(product?.items) ? product.items[0] : undefined;
  const size =
    (typeof firstItem?.size === 'string' && firstItem.size) ||
    (typeof firstItem?.itemInformation?.size === 'string' && firstItem.itemInformation.size) ||
    undefined;
  const soldBy =
    (typeof firstItem?.soldBy === 'string' && firstItem.soldBy) ||
    (typeof firstItem?.itemInformation?.soldBy === 'string' && firstItem.itemInformation.soldBy) ||
    undefined;
  const rawCount =
    (typeof firstItem?.count === 'number' && firstItem.count) ||
    (typeof firstItem?.itemInformation?.count === 'number' && firstItem.itemInformation.count) ||
    undefined;

  return {
    upc: product?.upc || '',
    description: product?.description || '',
    brand: product?.brand || '',
    size,
    soldBy,
    countPerPack: rawCount,
  };
}

const SEARCH_LIMIT_PRIMARY = 12;
const SEARCH_LIMIT_BROAD = 20;
const RERANK_MIN_SCORE_FOR_LLM = 60;

function upsertCandidate(list: ProductCandidate[], product: any): void {
  if (!product?.upc) return;
  const existing = list.find((c) => c.upc === product.upc);
  const next = toProductCandidate(product);
  if (!existing) {
    list.push(next);
    return;
  }
  existing.size = existing.size || next.size;
  existing.soldBy = existing.soldBy || next.soldBy;
  existing.countPerPack = existing.countPerPack || next.countPerPack;
}

function shouldBroadenBeforeLlm(ranked: ReturnType<typeof rankCandidatesForSelection>): boolean {
  if (ranked.length === 0) return true;
  const top = ranked[0];
  if (top.matchType === 'weak') return true;
  return top.score < RERANK_MIN_SCORE_FOR_LLM;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
export type FillCartResult =
  | { ok: true; itemCount: number; cartResponse: unknown; recipe: { ingredients: ShoppingIngredient[]; sections: RecipeSection[] }; mappings: IngredientMapping[] }
  | { ok: false; error: string };

export type SelectionResult =
  | { ok: true; itemCount: number; cartResponse: unknown; recipe: { ingredients: ShoppingIngredient[]; sections: RecipeSection[] }; mappings: IngredientMapping[]; dish: Dish }
  | { ok: false; error: string; needsAuth?: boolean; selection?: number; dish?: Dish };

// ---------------------------------------------------------------------------
// fillCart — reusable by both handleMealSelection and callback.ts auto-fill
// ---------------------------------------------------------------------------
export async function fillCart(
  dish: Dish,
  preferences: KVPreferences,
  userToken: string
): Promise<FillCartResult> {
  // Generate full recipe details
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const detailPrompt = buildDetailPrompt(dish, preferences);

  const detailRes = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: detailPrompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          ingredients: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                display: { type: Type.STRING },
                item: { type: Type.STRING },
                searchTerms: { type: Type.ARRAY, items: { type: Type.STRING } },
                forbiddenForms: { type: Type.ARRAY, items: { type: Type.STRING } },
                qty: { type: Type.NUMBER },
                qtyMode: { type: Type.STRING, enum: ['container', 'unit-count', 'single-pack'] },
              },
              required: ['display', 'item', 'searchTerms', 'qty', 'qtyMode'],
            },
          },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                steps: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      time: { type: Type.STRING },
                    },
                    required: ['text', 'time'],
                  },
                },
              },
              required: ['title', 'steps'],
            },
          },
        },
        required: ['ingredients', 'sections'],
      },
    },
  });

  const detailText = detailRes.text;
  if (!detailText) throw new Error('Empty detail response from Gemini');
  const detail = JSON.parse(detailText);
  const ingredients: ShoppingIngredient[] = detail.ingredients || [];
  const sections: RecipeSection[] = detail.sections || [];
  const recipe = { ingredients, sections };

  // Also add essentials from preferences
  const recipeItemCount = ingredients.length;
  const essentialEntries: Array<{ name: string; category?: EssentialItem['category'] }> = [];
  if (preferences.essentials) {
    for (const e of preferences.essentials) {
      const qty = parseInt(e.quantity) || 1;
      for (let i = 0; i < qty; i++) {
        essentialEntries.push({ name: e.name, category: e.category });
      }
    }
  }
  const totalItemCount = recipeItemCount + essentialEntries.length;

  // Find nearest store using saved zip code
  let locationId: string | undefined;
  if (preferences.zipCode) {
    try {
      const token = await getClientToken();
      const locRes = await fetch(
        `${KROGER_API_BASE}/locations?filter.zipCode.near=${preferences.zipCode}&filter.limit=1`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
      );
      if (locRes.ok) {
        const locData = await locRes.json();
        locationId = locData.data?.[0]?.locationId;
      }
    } catch (err) {
      console.error('Location lookup failed:', err);
    }
  }

  // Search products and build cart + ingredient mappings
  const cartItems: { upc: string; quantity: number }[] = [];
  const mappings: IngredientMapping[] = [];
  const clientToken = await getClientToken();

  for (let i = 0; i < totalItemCount; i++) {
    const isEssential = i >= recipeItemCount;

    // Structured path for recipe ingredients, legacy path for essentials
    let terms: string[];
    let parsed: ReturnType<typeof parseIngredient>;
    let displayName: string;
    let si: ShoppingIngredient | null = null;

    if (!isEssential) {
      si = ingredients[i];
      terms = getSearchTermsFromIntent(si);
      parsed = shoppingToParsed(si);
      displayName = si.display;
    } else {
      const essential = essentialEntries[i - recipeItemCount];
      const essentialName = essential?.name || '';
      terms = getSearchTerms(essentialName, essential?.category);
      parsed = parseIngredient(essentialName);
      displayName = essentialName;
    }

    if (terms.length === 0) continue;

    let matched = false;
    let matchedTerm = terms[0];

    try {
      // Collect candidates from all search terms.
      const candidates: ProductCandidate[] = [];

      for (const term of terms) {
        let url = `${KROGER_API_BASE}/products?filter.term=${encodeURIComponent(term)}&filter.limit=${SEARCH_LIMIT_PRIMARY}`;
        if (locationId) url += `&filter.locationId=${locationId}`;

        const prodRes = await fetch(url, {
          headers: { Authorization: `Bearer ${clientToken}`, Accept: 'application/json' },
        });

        if (prodRes.ok) {
          const prodData = await prodRes.json();
          for (const p of prodData.data || []) {
            upsertCandidate(candidates, p);
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      let filtered = si ? preFilterCandidates(candidates, si) : candidates;
      let ranked = filtered.length > 0
        ? rankCandidatesForSelection(filtered, parsed)
        : [];

      if (locationId && shouldBroadenBeforeLlm(ranked)) {
        const broadenTerms = Array.from(new Set([parsed.coreItem, ...terms]))
          .filter(Boolean)
          .slice(0, 3);
        for (const term of broadenTerms) {
          const url = `${KROGER_API_BASE}/products?filter.term=${encodeURIComponent(term)}&filter.limit=${SEARCH_LIMIT_BROAD}`;
          const prodRes = await fetch(url, {
            headers: { Authorization: `Bearer ${clientToken}`, Accept: 'application/json' },
          });
          if (prodRes.ok) {
            const prodData = await prodRes.json();
            for (const p of prodData.data || []) {
              upsertCandidate(candidates, p);
            }
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        filtered = si ? preFilterCandidates(candidates, si) : candidates;
        ranked = filtered.length > 0
          ? rankCandidatesForSelection(filtered, parsed)
          : [];
      }

      if (filtered.length > 0) {
        const best = ranked[0];

        if (best.matchType !== 'weak') {
          const qtyDecision = isEssential
            ? { cartQty: 1, confidence: 'high' as const, rationale: 'essential quantity comes from vault settings' }
            : best.qtyDecision;
          const qty = qtyDecision.cartQty;
          cartItems.push({ upc: best.upc, quantity: qty });
          mappings.push({
            ingredient: displayName, searchTerm: matchedTerm, attemptedTerms: terms,
            krogerProduct: best.description, krogerBrand: best.brand,
            upc: best.upc, isEssential,
            recipeQty: parsed.recipeQty, cartQty: qty,
            qtyMode: parsed.qtyMode, qtyConfidence: qtyDecision.confidence, qtyRationale: qtyDecision.rationale, matchType: best.matchType,
          });
          matched = true;
        }
      }

      if (!matched) {
        mappings.push({
          ingredient: displayName, searchTerm: matchedTerm, attemptedTerms: terms,
          krogerProduct: null, krogerBrand: null, upc: null, isEssential,
        });
      }
    } catch (err) {
      console.error(`Product search failed for "${matchedTerm}":`, err);
      mappings.push({
        ingredient: displayName, searchTerm: matchedTerm, attemptedTerms: terms,
        krogerProduct: null, krogerBrand: null, upc: null, isEssential,
      });
    }

    // Rate limit: 200ms between ingredients
    if (i < totalItemCount - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Add items to Kroger cart
  if (cartItems.length === 0) {
    return { ok: false, error: 'No products found for this recipe.' };
  }

  try {
    const cartRes = await fetch(`${KROGER_API_BASE}/cart/add`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ items: cartItems }),
    });

    // Log response structure for investigation (not raw payload)
    let cartResponse: unknown = null;
    try {
      cartResponse = await cartRes.json();
      const keys = cartResponse && typeof cartResponse === 'object'
        ? Object.keys(cartResponse)
        : [];
      console.log('Kroger cart response:', {
        status: cartRes.status,
        itemsSubmitted: cartItems.length,
        responseKeys: keys,
      });
    } catch {
      // Response may not be JSON
      console.log('Kroger cart response:', { status: cartRes.status, itemsSubmitted: cartItems.length });
    }

    if (!cartRes.ok) {
      console.error('Cart add failed:', cartRes.status);
      return {
        ok: false,
        error: `Mapped ${cartItems.length} items but couldn't add to cart (status ${cartRes.status}).`,
      };
    }

    return { ok: true, itemCount: cartItems.length, cartResponse, recipe, mappings };
  } catch (err: any) {
    console.error('Kroger cart error:', err);
    return { ok: false, error: 'Kroger cart request failed.' };
  }
}

// ---------------------------------------------------------------------------
// handleMealSelection — orchestrates the full selection flow
// ---------------------------------------------------------------------------
export async function handleMealSelection(
  selection: number | null
): Promise<SelectionResult> {
  // Load pending meals
  const pending = await redis.get<KVPendingMeals>(KV_KEYS.pendingMeals);

  if (!pending) {
    return { ok: false, error: 'No pending meals — open the app or wait for next Sunday.' };
  }

  if (selection === null || selection < 1 || selection > 3) {
    return { ok: false, error: 'Reply 1, 2, or 3 to pick a meal.' };
  }

  const dish = pending.dishes[selection - 1];
  if (!dish) {
    return { ok: false, error: 'Invalid selection. Reply 1, 2, or 3.' };
  }

  // Check Kroger session BEFORE Gemini call — avoid wasting API time
  const krogerSessionId = await redis.get<string>(KV_KEYS.krogerSessionPointer);

  if (!krogerSessionId) {
    return {
      ok: false,
      error: 'No Kroger session found. Sign in to fill your cart.',
      needsAuth: true,
      selection,
      dish,
    };
  }

  // Validate actual session, not just the pointer
  let userToken: string;
  try {
    userToken = await getUserToken(krogerSessionId);
  } catch {
    // Session is dead — clear both pointer and session to prevent stale-pointer loop
    await redis.del(KV_KEYS.krogerSessionPointer);
    await deleteUserSession(krogerSessionId);
    return {
      ok: false,
      error: 'Kroger session expired. Sign in again to fill your cart.',
      needsAuth: true,
      selection,
      dish,
    };
  }

  // Load preferences for detail prompt
  const preferences = await redis.get<KVPreferences>(KV_KEYS.preferences);
  if (!preferences) {
    return { ok: false, error: "Preferences not found — open the app to set up first." };
  }

  // Fill the cart
  const result = await fillCart(dish, preferences, userToken);

  if (result.ok === false) {
    return { ok: false as const, error: result.error };
  }

  // Clear pending meals on success
  await redis.del(KV_KEYS.pendingMeals);
  // Enrich dish with full recipe data for downstream use
  const enrichedDish: Dish = {
    ...dish,
    ingredients: result.recipe.ingredients,
    sections: result.recipe.sections,
  };
  return {
    ok: true as const,
    itemCount: result.itemCount,
    cartResponse: result.cartResponse,
    recipe: result.recipe,
    mappings: result.mappings,
    dish: enrichedDish,
  };
}
