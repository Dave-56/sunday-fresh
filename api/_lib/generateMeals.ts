import { GoogleGenAI, Type } from '@google/genai';
import { put, del } from '@vercel/blob';
import { redis } from './redis.js';
import { KV_KEYS, KV_TTL } from './kvSchema.js';
import type { KVPreferences, KVHistory, KVPendingMeals } from './kvSchema.js';
import { buildTeaserPrompt } from './buildPrompt.js';
import { sendMealOptions } from './notifier.js';
import type { Dish } from './types.js';

export interface GenerateResult {
  dishes: Dish[];
  imageCount: number;
}

/**
 * Generate 3 meal teasers + photos, store in Redis, send via Telegram/Twilio.
 *
 * Shared by the weekly cron and the "Regenerate" button flow.
 * Cleans up old Blob images and Telegram messages from the previous round.
 */
export async function generateAndSendMeals(): Promise<GenerateResult> {
  // 1. Load user data from Redis
  const preferences = await redis.get<KVPreferences>(KV_KEYS.preferences);
  if (!preferences) {
    throw new Error('No preferences found in Redis — user must sync first');
  }

  const history = (await redis.get<KVHistory>(KV_KEYS.history)) || [];
  const recentDishNames = history.map((h) => h.dish.name);

  // 1b. Clean up old Blob images from previous pending meals
  const oldPending = await redis.get<KVPendingMeals>(KV_KEYS.pendingMeals);
  if (oldPending?.imageUrls) {
    await Promise.all(
      oldPending.imageUrls
        .filter((u) => u.length > 0)
        .map((url) => del(url).catch((err) => console.error(`Blob delete failed: ${url}`, err)))
    );
  }

  // 2. Generate 3 meal teasers
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const prompt = buildTeaserPrompt(preferences, recentDishNames);

  const teaserRes = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            cuisine: { type: Type.STRING },
            why: { type: Type.STRING },
            difficulty: { type: Type.STRING, enum: ['Easy', 'Intermediate'] },
            prepTime: { type: Type.STRING },
            servings: { type: Type.NUMBER },
            type: { type: Type.STRING, enum: ['Heritage', 'Explorer'] },
            servedWith: {
              type: Type.OBJECT,
              properties: {
                primary: { type: Type.STRING },
                alternatives: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['primary', 'alternatives'],
            },
          },
          required: ['name', 'cuisine', 'why', 'difficulty', 'prepTime', 'servings', 'type', 'servedWith'],
        },
      },
    },
  });

  const teaserText = teaserRes.text;
  if (!teaserText) throw new Error('Empty teaser response from Gemini');

  const dishes: Dish[] = JSON.parse(teaserText);
  if (!Array.isArray(dishes) || dishes.length < 3) {
    throw new Error(`Expected 3 dishes, got ${dishes?.length}`);
  }

  // 3 & 4. Generate images in parallel + upload to Blob
  const imageUrls = await Promise.all(
    dishes.map(async (dish) => {
      try {
        const imgRes = await ai.models.generateContent({
          model: 'gemini-3.1-flash-image-preview',
          contents: {
            parts: [
              {
                text: `A museum-grade professional editorial food photograph of ${dish.name} (${dish.cuisine})${dish.servedWith ? `, served with ${dish.servedWith.primary}` : ''}. Top-down aerial view (flat lay) on a perfectly clean, solid minimalist background. Vibrant colors, natural bright lighting, macro textures. Everything must be fully visible within the frame — no cropping, nothing cut off at the edges. All items centered in the composition with generous padding from the edges. Served in elegant, modern ceramic bowls or plates. STRICT MINIMALISM: No scattered garnishes, no loose herbs, no napkins, no cutlery. Only the food vessels and their contents. The food is the absolute hero. High-end culinary magazine style. No people.`,
              },
            ],
          },
          config: {
            imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
          },
        });

        for (const part of imgRes.candidates![0].content!.parts!) {
          if (part.inlineData) {
            const buffer = Buffer.from(part.inlineData.data!, 'base64');
            const slug = dish.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const blob = await put(`meals/${slug}-${Date.now()}.png`, buffer, {
              access: 'public',
              contentType: 'image/png',
            });
            return blob.url;
          }
        }

        return ''; // fallback — no image generated
      } catch (err) {
        console.error(`Image generation failed for ${dish.name}:`, err);
        return ''; // continue without image
      }
    })
  );

  // 5. Send via Telegram/Twilio and collect message IDs
  const validImageUrls = imageUrls.filter((u) => u.length > 0);
  const messageIds = await sendMealOptions(dishes, validImageUrls);

  // 6. Store pending meals in Redis with 24h TTL
  const pending: KVPendingMeals = {
    dishes,
    imageUrls,
    timestamp: Date.now(),
    messageIds,
  };
  await redis.set(KV_KEYS.pendingMeals, pending, {
    ex: KV_TTL.pendingMeals,
  });

  return { dishes, imageCount: validImageUrls.length };
}
