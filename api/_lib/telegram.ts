import type { Dish } from './types.js';

const botToken = () => process.env.TELEGRAM_BOT_TOKEN!;
const chatId = () => process.env.TELEGRAM_CHAT_ID!;

async function callApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram ${method} failed: ${text}`);
  }
  return res.json();
}

/**
 * Send meal option photos + inline keyboard buttons (1 / 2 / 3)
 */
export async function sendMealOptions(
  dishes: Dish[],
  imageUrls: string[]
): Promise<void> {
  // Send each photo individually with its dish name
  for (let i = 0; i < dishes.length; i++) {
    const d = dishes[i];
    const url = imageUrls[i];
    const servedLine = d.servedWith?.primary ? `\nBest with: ${d.servedWith.primary}` : '';
    if (url) {
      await callApi('sendPhoto', {
        chat_id: chatId(),
        photo: url,
        caption: `${i + 1}. ${d.name}\n${d.cuisine} — ${d.type}${servedLine}`,
      });
    } else {
      await callApi('sendMessage', {
        chat_id: chatId(),
        text: `${i + 1}. ${d.name}\n${d.cuisine} — ${d.type}${servedLine}`,
      });
    }
  }

  // Send pick message with inline keyboard
  const text = `sunday. — tap to pick your meal this week:`;

  await callApi('sendMessage', {
    chat_id: chatId(),
    text,
    reply_markup: {
      inline_keyboard: [
        dishes.slice(0, 3).map((d, i) => ({
          text: `${i + 1}. ${d.name}`,
          callback_data: `pick:${i + 1}`,
        })),
      ],
    },
  });
}

/**
 * Send a "cart ready" confirmation
 */
export async function sendCartReady(itemCount: number): Promise<void> {
  await callApi('sendMessage', {
    chat_id: chatId(),
    text: `sunday. — Cart ready! ${itemCount} items added to your Kroger cart.\n\nTap to checkout: https://www.kroger.com/cart`,
  });
}

/**
 * Send an error/fallback message
 */
export async function sendError(message: string): Promise<void> {
  const appUrl = process.env.APP_URL || '';
  await callApi('sendMessage', {
    chat_id: chatId(),
    text: `sunday. — ${message}${appUrl ? `\n\nOpen the app: ${appUrl}` : ''}`,
  });
}

/**
 * Answer a callback query (removes the loading spinner on the button)
 */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await callApi('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text || 'Got it!',
  });
}

/**
 * Parse a callback_data or text reply into a meal selection (1, 2, or 3) or null
 */
export function parseSelection(data: string): number | null {
  // Handle callback_data format "pick:1"
  const pickMatch = data.match(/^pick:(\d)$/);
  if (pickMatch) {
    const n = parseInt(pickMatch[1], 10);
    if (n >= 1 && n <= 3) return n;
  }
  // Handle plain text "1", "2", "3"
  const trimmed = data.trim();
  const n = parseInt(trimmed, 10);
  if (n >= 1 && n <= 3 && trimmed === String(n)) return n;
  return null;
}
