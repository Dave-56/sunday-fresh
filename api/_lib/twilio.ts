import twilio from 'twilio';
import type { Dish } from './types.js';

function getClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  );
}

const from = () => process.env.TWILIO_PHONE_NUMBER!;
const userPhone = () => process.env.USER_PHONE_NUMBER!;

/**
 * Send MMS with 3 meal photos + "Reply 1, 2, or 3"
 */
export async function sendMealOptions(
  dishes: Dish[],
  imageUrls: string[]
): Promise<string> {
  const client = getClient();

  const body =
    `sunday. — your 3 meals this week:\n\n` +
    dishes
      .map((d, i) => `${i + 1}. ${d.name} (${d.cuisine}) — ${d.type}`)
      .join('\n') +
    `\n\nReply 1, 2, or 3`;

  const msg = await client.messages.create({
    from: from(),
    to: userPhone(),
    body,
    mediaUrl: imageUrls.slice(0, 3), // MMS supports up to 10, we send 3
  });

  return msg.sid;
}

/**
 * Send a "cart ready" confirmation SMS
 */
export async function sendCartReady(itemCount: number): Promise<string> {
  const client = getClient();
  const msg = await client.messages.create({
    from: from(),
    to: userPhone(),
    body: `sunday. — Cart ready! ${itemCount} items added to your Kroger cart.\n\nTap to checkout: https://www.kroger.com/cart`,
  });
  return msg.sid;
}

/**
 * Send an error/fallback SMS
 */
export async function sendError(message: string): Promise<string> {
  const client = getClient();
  const appUrl = process.env.APP_URL || '';
  const msg = await client.messages.create({
    from: from(),
    to: userPhone(),
    body: `sunday. — ${message}\n\nOpen the app: ${appUrl}`,
  });
  return msg.sid;
}

/**
 * Parse an SMS reply body into a meal selection (1, 2, or 3) or null
 */
export function parseReply(body: string): number | null {
  const trimmed = body.trim();
  const n = parseInt(trimmed, 10);
  if (n >= 1 && n <= 3 && trimmed === String(n)) return n;
  return null;
}
