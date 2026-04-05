import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseReply, sendCartReady, sendError } from '../_lib/twilio.js';
import { handleMealSelection } from '../_lib/handleMealSelection.js';

/**
 * POST /api/twilio/incoming
 * Twilio webhook — receives SMS replies and processes meal selection.
 *
 * Flow:
 *   User texts "2" -> pick dish #2 -> generate details -> map to Kroger -> fill cart -> confirm SMS
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const body = (req.body?.Body as string) || '';
    const selection = parseReply(body);

    const result = await handleMealSelection(selection);

    if (result.ok === true) {
      await sendCartReady(result.itemCount);
    } else {
      await sendError(result.error);
    }

    return twimlResponse(res);
  } catch (err: any) {
    console.error('Twilio incoming error:', err);
    try {
      await sendError('Something went wrong filling your cart — open the app.');
    } catch (_) {}
    return twimlResponse(res);
  }
}

/** Return empty TwiML so Twilio doesn't retry */
function twimlResponse(res: VercelResponse) {
  res.setHeader('Content-Type', 'text/xml');
  return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
}
