import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleMealSelection } from '../_lib/handleMealSelection.js';
import { generateAndSendMeals } from '../_lib/generateMeals.js';
import { parseSelection, answerCallbackQuery, sendCartReady, sendError, deleteMessage, sendTextMessage } from '../_lib/telegram.js';
import { redis } from '../_lib/redis.js';
import { KV_KEYS } from '../_lib/kvSchema.js';
import type { KVPendingMeals } from '../_lib/kvSchema.js';

/**
 * POST /api/telegram/incoming
 * Telegram webhook — receives button taps and text replies.
 * Handles meal selection (pick:1/2/3) and regeneration.
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

    // --- Regenerate flow ---
    if (selectionRaw === 'regenerate') {
      // Answer callback immediately so button stops spinning
      if (callbackQueryId) {
        await answerCallbackQuery(callbackQueryId, 'Regenerating...');
      }

      // Spam guard: skip if last generation was < 60s ago
      const pending = await redis.get<KVPendingMeals>(KV_KEYS.pendingMeals);
      if (pending && Date.now() - pending.timestamp < 60_000) {
        await sendTextMessage('Hold on — still processing the last batch!');
        return res.json({ ok: true });
      }

      // Delete old messages from chat
      if (pending?.messageIds) {
        await Promise.all(pending.messageIds.map((id) => deleteMessage(id)));
      }

      // Let the user know it's working
      const waitMsgId = await sendTextMessage('Generating new options...');

      try {
        await generateAndSendMeals();
        // Clean up the "Generating..." message
        await deleteMessage(waitMsgId);
      } catch (err: any) {
        console.error('Regenerate failed:', err);
        await deleteMessage(waitMsgId);
        await sendError("Couldn't regenerate meals — try again or open the app.");
      }

      return res.json({ ok: true });
    }

    // --- Meal selection flow ---
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
