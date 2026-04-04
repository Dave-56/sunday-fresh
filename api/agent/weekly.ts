import { GoogleGenAI, Type } from '@google/genai';
import { put } from '@vercel/blob';
import { Redis } from '@upstash/redis';
import { KV_KEYS, KV_TTL } from '../_lib/kvSchema';
import type { KVPreferences, KVHistory, KVPendingMeals } from '../_lib/kvSchema';
import { buildTeaserPrompt } from '../_lib/buildPrompt';
import { sendMealOptions, sendError } from '../_lib/twilio';
import type { Dish } from '../_lib/types';

const redis = Redis.fromEnv();

/**
 * GET /api/agent/weekly
 * Triggered by Vercel Cron every Sunday at 14:00 UTC (8am CT).
 *
 * 1. Load preferences + history from Redis
 * 2. Generate 3 meal teasers via Gemini
 * 3. Generate 3 food photos via Gemini (parallel)
 * 4. Upload photos to Vercel Blob
 * 5. Store pending meals in Redis (24h TTL)
 * 6. Send MMS via Twilio
 */
export async function GET(req: Request) {
  // Verify cron secret in production
  const authHeader = req.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // 1. Load user data from Redis
    const preferences = await redis.get<KVPreferences>(KV_KEYS.preferences);
    if (!preferences) {
      console.error('No preferences found in Redis — user must sync first');
      return Response.json({ error: 'No preferences' }, { status: 400 });
    }

    const history = (await redis.get<KVHistory>(KV_KEYS.history)) || [];
    const recentDishNames = history.map((h) => h.dish.name);

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
            },
            required: ['name', 'cuisine', 'why', 'difficulty', 'prepTime', 'servings', 'type'],
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
                  text: `A museum-grade professional editorial food photograph of ${dish.name} (${dish.cuisine}). Top-down aerial view (flat lay) on a perfectly clean, solid minimalist background. Vibrant colors, natural bright lighting, macro textures. Served in a single elegant, modern ceramic bowl or plate. STRICT MINIMALISM: No side garnishes, no lime wedges, no scattered herbs, no side piles of ingredients, no napkins, no cutlery. Only the main dish vessel and its contents. The food is the absolute hero. High-end culinary magazine style. No people.`,
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

    // 5. Store pending meals in Redis with 24h TTL
    const pending: KVPendingMeals = {
      dishes,
      imageUrls,
      timestamp: Date.now(),
    };
    await redis.set(KV_KEYS.pendingMeals, pending, {
      ex: KV_TTL.pendingMeals,
    });

    // 6. Send MMS
    const validImageUrls = imageUrls.filter((u) => u.length > 0);
    await sendMealOptions(dishes, validImageUrls);

    return Response.json({
      ok: true,
      dishes: dishes.map((d) => d.name),
      images: validImageUrls.length,
    });
  } catch (err: any) {
    console.error('Weekly agent error:', err);
    // Send fallback SMS so user isn't left hanging
    try {
      await sendError(
        "Couldn't generate meals this week — open the app to pick manually."
      );
    } catch (smsErr) {
      console.error('Failed to send error SMS:', smsErr);
    }
    return Response.json({ error: err.message }, { status: 500 });
  }
}
