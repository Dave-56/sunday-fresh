import { GoogleGenAI, Type } from '@google/genai';
import { redis } from './redis.js';
import { KV_KEYS } from './kvSchema.js';
import type { KVPreferences, KVPendingMeals } from './kvSchema.js';
import { buildDetailPrompt } from './buildPrompt.js';
import { cleanSearchTerm } from './ingredients.js';
import { getClientToken, getUserToken, KROGER_API_BASE } from './krogerServer.js';

export type SelectionResult =
  | { ok: true; itemCount: number }
  | { ok: false; error: string };

/**
 * Handle a meal selection (1, 2, or 3):
 *  1. Load pending meals from Redis
 *  2. Validate selection
 *  3. Generate recipe details via Gemini
 *  4. Map ingredients to Kroger products
 *  5. Add to Kroger cart
 *  6. Clear pending meals
 */
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

  // Load preferences for detail prompt
  const preferences = await redis.get<KVPreferences>(KV_KEYS.preferences);
  if (!preferences) {
    return { ok: false, error: "Preferences not found — open the app to set up first." };
  }

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

  // Also add essentials from preferences
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

  // Search products and build cart
  const cartItems: { upc: string; quantity: number }[] = [];
  const clientToken = await getClientToken();

  for (let i = 0; i < allItems.length; i++) {
    const term = cleanSearchTerm(allItems[i]);
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
        }
      }
    } catch (err) {
      console.error(`Product search failed for "${term}":`, err);
    }

    // Rate limit: 200ms between requests
    if (i < allItems.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Add items to Kroger cart
  if (cartItems.length > 0) {
    const krogerSessionId = await redis.get<string>('user:kroger_session_id');

    if (krogerSessionId) {
      try {
        const userToken = await getUserToken(krogerSessionId);
        const cartRes = await fetch(`${KROGER_API_BASE}/cart/add`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ items: cartItems }),
        });

        if (!cartRes.ok) {
          const errText = await cartRes.text();
          console.error('Cart add failed:', errText);
          return {
            ok: false,
            error: `Mapped ${cartItems.length} items but couldn't add to cart — Kroger session may have expired. Re-login in the app.`,
          };
        }
      } catch (err: any) {
        console.error('Kroger cart error:', err);
        return {
          ok: false,
          error: 'Kroger session expired — re-login in the app, then reply again.',
        };
      }
    } else {
      return {
        ok: false,
        error: `Mapped ${cartItems.length} items but no Kroger session found. Log in via the app first.`,
      };
    }
  }

  // Clear pending meals
  await redis.del(KV_KEYS.pendingMeals);

  return { ok: true, itemCount: cartItems.length };
}
