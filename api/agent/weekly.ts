import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateAndSendMeals } from '../_lib/generateMeals.js';
import { sendError } from '../_lib/notifier.js';

/**
 * GET /api/agent/weekly
 * Triggered by Vercel Cron every Sunday at 15:00 UTC (8am PT).
 *
 * Generates 3 meal teasers with photos and sends them via Telegram.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret in production
  const authHeader = req.headers.authorization;
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const result = await generateAndSendMeals();

    return res.json({
      ok: true,
      dishes: result.dishes.map((d) => d.name),
      images: result.imageCount,
    });
  } catch (err: any) {
    console.error('Weekly agent error:', err);
    try {
      await sendError(
        "Couldn't generate meals this week — open the app to pick manually."
      );
    } catch (smsErr) {
      console.error('Failed to send error notification:', smsErr);
    }
    return res.status(500).json({ error: err.message });
  }
}
