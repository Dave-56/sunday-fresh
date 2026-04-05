import { GoogleGenAI, Type } from '@google/genai';
import { redis } from './redis.js';
import { KV_KEYS } from './kvSchema.js';
import type { KVPreferences, KVPendingMeals } from './kvSchema.js';
import { buildDetailPrompt } from './buildPrompt.js';
import { cleanSearchTerm } from './ingredients.js';
import {
  getClientToken,
  getUserToken,
  deleteUserSession,
  KROGER_API_BASE,
} from './krogerServer.js';
import type { Dish, RecipeSection, IngredientMapping } from './types.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
export type FillCartResult =
  | { ok: true; itemCount: number; cartResponse: unknown; recipe: { ingredients: string[]; sections: RecipeSection[] }; mappings: IngredientMapping[] }
  | { ok: false; error: string };

export type SelectionResult =
  | { ok: true; itemCount: number; cartResponse: unknown; recipe: { ingredients: string[]; sections: RecipeSection[] }; mappings: IngredientMapping[]; dish: Dish }
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
          ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
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
  const ingredients: string[] = detail.ingredients || [];
  const sections: RecipeSection[] = detail.sections || [];
  const recipe = { ingredients, sections };

  // Also add essentials from preferences
  const recipeItemCount = ingredients.length;
  const allItems: string[] = [...ingredients];
  if (preferences.essentials) {
    for (const e of preferences.essentials) {
      const qty = parseInt(e.quantity) || 1;
      for (let i = 0; i < qty; i++) {
        allItems.push(e.name);
      }
    }
  }

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

  for (let i = 0; i < allItems.length; i++) {
    const term = cleanSearchTerm(allItems[i]);
    const isEssential = i >= recipeItemCount;
    if (!term) continue;

    try {
      let url = `${KROGER_API_BASE}/products?filter.term=${encodeURIComponent(term)}&filter.limit=1`;
      if (locationId) url += `&filter.locationId=${locationId}`;

      const prodRes = await fetch(url, {
        headers: { Authorization: `Bearer ${clientToken}`, Accept: 'application/json' },
      });

      if (prodRes.ok) {
        const prodData = await prodRes.json();
        const product = prodData.data?.[0];
        if (product?.upc) {
          cartItems.push({ upc: product.upc, quantity: 1 });
          mappings.push({
            ingredient: allItems[i], searchTerm: term,
            krogerProduct: product.description || null,
            krogerBrand: product.brand || null,
            upc: product.upc, isEssential,
          });
        } else {
          mappings.push({
            ingredient: allItems[i], searchTerm: term,
            krogerProduct: null, krogerBrand: null, upc: null, isEssential,
          });
        }
      } else {
        mappings.push({
          ingredient: allItems[i], searchTerm: term,
          krogerProduct: null, krogerBrand: null, upc: null, isEssential,
        });
      }
    } catch (err) {
      console.error(`Product search failed for "${term}":`, err);
      mappings.push({
        ingredient: allItems[i], searchTerm: term,
        krogerProduct: null, krogerBrand: null, upc: null, isEssential,
      });
    }

    // Rate limit: 200ms between requests
    if (i < allItems.length - 1) {
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
