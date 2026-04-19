import { Type } from '@google/genai';
import { getGenAIClient } from './genaiClient.js';
import { redis } from './redis.js';
import { KV_KEYS } from './kvSchema.js';
import type { KVPreferences, KVPendingMeals } from './kvSchema.js';
import { buildDetailPrompt } from './buildPrompt.js';
import { getSearchTerms, getSearchTermsFromIntent } from './ingredients.js';
import { parseIngredient, shoppingToParsed, rankCandidatesForSelection, preFilterCandidates, type ProductCandidate, type StructuredIngredientIntent } from './matchScorer.js';
import { selectCandidateWithRerank } from './candidateSelector.js';
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

const ENABLE_LLM_RERANK_TG = (() => {
  const raw = String(process.env.ENABLE_LLM_RERANK_TG || '').toLowerCase();
  return raw === '1' || raw === 'true';
})();
const ENABLE_LLM_RERANK_TG_ESSENTIALS = (() => {
  const raw = String(process.env.ENABLE_LLM_RERANK_TG_ESSENTIALS || '').toLowerCase();
  return raw === '1' || raw === 'true';
})();
const MAX_LLM_RERANK_CALLS_TG = (() => {
  const raw = parseInt(process.env.MAX_LLM_RERANK_CALLS_TG || '', 10);
  return Number.isFinite(raw) ? raw : 6;
})();
const LLM_SCORE_MIN = 40;
const LLM_SCORE_MAX = 80;

function shouldTryLlmForTopCandidate(
  top: ReturnType<typeof rankCandidatesForSelection>[number] | undefined
): boolean {
  if (!top) return false;
  if (top.matchType === 'weak') return false;
  const inAmbiguousBand = top.score >= LLM_SCORE_MIN && top.score <= LLM_SCORE_MAX;
  const needsReviewSignal = top.matchType === 'substitute' || top.qtyDecision.confidence !== 'high';
  return inAmbiguousBand || needsReviewSignal;
}

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
  const t0 = Date.now();
  console.log('[tg-fill] start', { dish: dish.name });

  // Generate full recipe details
  const ai = getGenAIClient();
  const detailPrompt = buildDetailPrompt(dish, preferences);

  const tGemini = Date.now();
  const detailRes = await ai.models.generateContent({
    model: process.env.RECIPE_GENERATION_MODEL || 'gemini-3-flash-preview',
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

  const geminiMs = Date.now() - tGemini;
  const detailText = detailRes.text;
  if (!detailText) {
    console.error('[tg-fill] gemini empty response', { geminiMs });
    throw new Error('Empty detail response from Gemini');
  }
  const detail = JSON.parse(detailText);
  const ingredients: ShoppingIngredient[] = detail.ingredients || [];
  const sections: RecipeSection[] = detail.sections || [];
  const recipe = { ingredients, sections };
  console.log('[tg-fill] gemini done', { geminiMs, ingredients: ingredients.length });

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
    const tLoc = Date.now();
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
      console.log('[tg-fill] location lookup', { ms: Date.now() - tLoc, status: locRes.status, locationId: locationId || null });
    } catch (err) {
      console.error('[tg-fill] location lookup failed', { ms: Date.now() - tLoc, err: (err as any)?.message });
    }
  }

  // Search products and build cart + ingredient mappings
  const cartItems: { upc: string; quantity: number }[] = [];
  const mappings: IngredientMapping[] = [];
  const clientToken = await getClientToken();
  let llmCallsUsed = 0;
  const tLoopStart = Date.now();
  let searchMsTotal = 0;
  let llmMsTotal = 0;

  for (let i = 0; i < totalItemCount; i++) {
    const tItem = Date.now();
    let itemSearchMs = 0;
    let itemLlmMs = 0;
    let itemBroadened = false;
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

      const tSearch = Date.now();
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
      itemSearchMs += Date.now() - tSearch;

      let filtered = si ? preFilterCandidates(candidates, si) : candidates;
      let ranked = filtered.length > 0
        ? rankCandidatesForSelection(filtered, parsed)
        : [];

      if (locationId && shouldBroadenBeforeLlm(ranked)) {
        itemBroadened = true;
        const tBroaden = Date.now();
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
        itemSearchMs += Date.now() - tBroaden;
        filtered = si ? preFilterCandidates(candidates, si) : candidates;
        ranked = filtered.length > 0
          ? rankCandidatesForSelection(filtered, parsed)
          : [];
      }

      if (filtered.length > 0) {
        let best: typeof ranked[0] | undefined = ranked[0];
        let forceNeedsReview = false;
        let decisionSource: IngredientMapping['decisionSource'] = 'deterministic';
        let decisionReason: string | undefined;
        let guardrailOverride: string | undefined;

        // Build intent for LLM reranker
        const llmIntent: StructuredIngredientIntent | null = si || (best ? {
          display: displayName,
          item: parsed.coreItem || displayName,
          searchTerms: terms.length > 0 ? terms : [parsed.coreItem || displayName],
          qty: parsed.recipeQty,
          qtyMode: parsed.qtyMode,
        } : null);

        const shouldTryLlm =
          !!llmIntent &&
          ENABLE_LLM_RERANK_TG &&
          ranked.length > 0 &&
          shouldTryLlmForTopCandidate(ranked[0]) &&
          (!isEssential || ENABLE_LLM_RERANK_TG_ESSENTIALS);

        if (shouldTryLlm) {
          if (llmCallsUsed >= MAX_LLM_RERANK_CALLS_TG) {
            decisionSource = 'fallback';
            decisionReason = 'LLM budget cap reached for this cart fill; deterministic selection used.';
            guardrailOverride = 'llm_budget_cap';
          } else {
            const tLlm = Date.now();
            try {
              const rerankResult = await selectCandidateWithRerank(
                llmIntent!,
                filtered,
                {
                  enableLlm: true,
                  llmTimeoutMs: parseInt(process.env.LLM_RERANK_TIMEOUT_MS || '', 10) || 7000,
                  requestId: `tg_${i}`,
                }
              );
              itemLlmMs += Date.now() - tLlm;
              llmCallsUsed += 1;

              decisionSource = rerankResult.metadata.decisionSource;
              decisionReason = rerankResult.reason;
              guardrailOverride = rerankResult.metadata.guardrailOverride;

              if (rerankResult.decision === 'no_match') {
                best = undefined;
              } else if (rerankResult.selectedUpc) {
                const selected = ranked.find((r) => r.upc === rerankResult.selectedUpc);
                if (selected) best = selected;
              }

              if (rerankResult.decision === 'needs_review') {
                forceNeedsReview = true;
              }
            } catch (err: any) {
              itemLlmMs += Date.now() - tLlm;
              decisionSource = 'fallback';
              decisionReason = err?.message || 'LLM rerank unavailable; deterministic selection used.';
              guardrailOverride = 'llm_error';
              console.error('[tg-fill] llm rerank failed', { ingredient: displayName, ms: itemLlmMs, err: err?.message });
            }
          }
        }

        if (best && best.matchType !== 'weak') {
          const qtyDecision = isEssential
            ? { cartQty: 1, confidence: 'high' as const, rationale: 'essential quantity comes from vault settings' }
            : best.qtyDecision;
          // Guardrail: low qty confidence or LLM needs_review → treat as substitute
          const effectiveMatchType: typeof best.matchType =
            !isEssential && (qtyDecision.confidence === 'low' || forceNeedsReview)
              ? 'substitute'
              : best.matchType;
          const qty = qtyDecision.cartQty;
          cartItems.push({ upc: best.upc, quantity: qty });
          mappings.push({
            ingredient: displayName, searchTerm: matchedTerm, attemptedTerms: terms,
            krogerProduct: best.description, krogerBrand: best.brand,
            upc: best.upc, isEssential,
            recipeQty: parsed.recipeQty, cartQty: qty,
            qtyMode: parsed.qtyMode, qtyConfidence: qtyDecision.confidence, qtyRationale: qtyDecision.rationale,
            matchType: effectiveMatchType,
            decisionSource, decisionReason, guardrailOverride,
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

    searchMsTotal += itemSearchMs;
    llmMsTotal += itemLlmMs;
    console.log('[tg-fill] ingredient', {
      i: i + 1,
      of: totalItemCount,
      name: displayName,
      essential: isEssential,
      matched,
      broadened: itemBroadened,
      searchMs: itemSearchMs,
      llmMs: itemLlmMs,
      totalMs: Date.now() - tItem,
    });

    // Rate limit: 200ms between ingredients
    if (i < totalItemCount - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  console.log('[tg-fill] loop done', {
    loopMs: Date.now() - tLoopStart,
    searchMsTotal,
    llmMsTotal,
    llmCallsUsed,
    cartItems: cartItems.length,
  });

  // Add items to Kroger cart
  if (cartItems.length === 0) {
    return { ok: false, error: 'No products found for this recipe.' };
  }

  const tCart = Date.now();
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
      console.log('[tg-fill] cart PUT', {
        ms: Date.now() - tCart,
        status: cartRes.status,
        itemsSubmitted: cartItems.length,
        responseKeys: keys,
      });
    } catch {
      console.log('[tg-fill] cart PUT', { ms: Date.now() - tCart, status: cartRes.status, itemsSubmitted: cartItems.length });
    }

    if (!cartRes.ok) {
      console.error('[tg-fill] cart add failed', { status: cartRes.status });
      return {
        ok: false,
        error: `Mapped ${cartItems.length} items but couldn't add to cart (status ${cartRes.status}).`,
      };
    }

    console.log('[tg-fill] done', { totalMs: Date.now() - t0, itemCount: cartItems.length });
    return { ok: true, itemCount: cartItems.length, cartResponse, recipe, mappings };
  } catch (err: any) {
    console.error('[tg-fill] cart PUT error', { ms: Date.now() - tCart, err: err?.message });
    return { ok: false, error: 'Kroger cart request failed.' };
  }
}

// ---------------------------------------------------------------------------
// handleMealSelection — orchestrates the full selection flow
// ---------------------------------------------------------------------------
export async function handleMealSelection(
  selection: number | null
): Promise<SelectionResult> {
  const tStart = Date.now();
  console.log('[tg-select] start', { selection });
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
    console.log('[tg-select] needsAuth: no session pointer');
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
  } catch (err: any) {
    console.log('[tg-select] needsAuth: session expired', { err: err?.message });
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
  console.log('[tg-select] fillCart returned', { ok: result.ok, totalMs: Date.now() - tStart });

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
