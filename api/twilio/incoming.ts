import { GoogleGenAI, Type } from '@google/genai';
import { Redis } from '@upstash/redis';
import { KV_KEYS } from '../../src/lib/kvSchema';
import type { KVPreferences, KVPendingMeals } from '../../src/lib/kvSchema';
import { buildDetailPrompt } from '../../src/lib/buildPrompt';
import { cleanSearchTerm } from '../../src/lib/ingredients';
import { parseReply, sendCartReady, sendError } from '../../src/lib/twilio';
import {
  getClientToken,
  getUserToken,
  KROGER_API_BASE,
  redis as krogerRedis,
} from '../../src/lib/krogerServer';

const redis = Redis.fromEnv();

/**
 * POST /api/twilio/incoming
 * Twilio webhook — receives SMS replies and processes meal selection.
 *
 * Flow:
 *   User texts "2" → pick dish #2 → generate details → map to Kroger → fill cart → confirm SMS
 */
export async function POST(req: Request) {
  try {
    // Parse Twilio's URL-encoded webhook body
    const formData = await req.formData();
    const body = formData.get('Body') as string;
    const from = formData.get('From') as string;

    const selection = parseReply(body || '');

    // Load pending meals
    const pending = await redis.get<KVPendingMeals>(KV_KEYS.pendingMeals);

    if (!pending) {
      await sendError('No pending meals — open the app or wait for next Sunday.');
      return twimlResponse();
    }

    if (selection === null) {
      await sendError('Reply 1, 2, or 3 to pick a meal.');
      return twimlResponse();
    }

    const dish = pending.dishes[selection - 1];
    if (!dish) {
      await sendError('Invalid selection. Reply 1, 2, or 3.');
      return twimlResponse();
    }

    // Load preferences for detail prompt
    const preferences = await redis.get<KVPreferences>(KV_KEYS.preferences);
    if (!preferences) {
      await sendError("Preferences not found — open the app to set up first.");
      return twimlResponse();
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

    // Map ingredients to Kroger products
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
      // Use the stored Kroger session from Redis
      // The session key format is user:kroger_session:{sessionId}
      // For MVP single-user, we look for any active session
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
            await sendError(
              `Mapped ${cartItems.length} items but couldn't add to cart — Kroger session may have expired. Re-login in the app.`
            );
            return twimlResponse();
          }
        } catch (err: any) {
          console.error('Kroger cart error:', err);
          await sendError(
            'Kroger session expired — re-login in the app, then reply again.'
          );
          return twimlResponse();
        }
      } else {
        await sendError(
          `Mapped ${cartItems.length} items but no Kroger session found. Log in via the app first.`
        );
        return twimlResponse();
      }
    }

    // Clear pending meals
    await redis.del(KV_KEYS.pendingMeals);

    // Send confirmation
    await sendCartReady(cartItems.length);

    return twimlResponse();
  } catch (err: any) {
    console.error('Twilio incoming error:', err);
    try {
      await sendError('Something went wrong filling your cart — open the app.');
    } catch (_) {}
    return twimlResponse();
  }
}

/** Return empty TwiML so Twilio doesn't retry */
function twimlResponse() {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { headers: { 'Content-Type': 'text/xml' } }
  );
}
