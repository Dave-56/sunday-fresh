import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleMealSelection } from '../_lib/handleMealSelection.js';
import { parseSelection, answerCallbackQuery, sendCartReady, sendError } from '../_lib/telegram.js';

/**
 * POST /api/telegram/incoming
 * Telegram webhook — receives button taps and text replies, processes meal selection.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  // Validate webhook secret
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const update = req.body;
    let selectionRaw: string | null = null;
    let callbackQueryId: string | null = null;

    // Handle inline keyboard button press
    if (update.callback_query) {
      callbackQueryId = update.callback_query.id;
      selectionRaw = update.callback_query.data || '';
    }
    // Handle plain text message
    else if (update.message?.text) {
      selectionRaw = update.message.text;
    }

    if (!selectionRaw) {
      return res.json({ ok: true });
    }

    const selection = parseSelection(selectionRaw);

    // Answer callback query immediately to remove loading spinner
    if (callbackQueryId) {
      await answerCallbackQuery(
        callbackQueryId,
        selection !== null ? `Picking meal ${selection}...` : 'Invalid selection'
      );
    }

    const result = await handleMealSelection(selection);

    if (result.ok === true) {
      await sendCartReady(result.itemCount);
    } else {
      await sendError(result.error);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('Telegram incoming error:', err);
    try {
      await sendError('Something went wrong filling your cart — open the app.');
    } catch (_) {}
    return res.json({ ok: true });
  }
}
