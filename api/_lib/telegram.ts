import type { Dish, RecipeSection, IngredientMapping } from './types.js';

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
 * Send meal option photos + inline keyboard buttons (1 / 2 / 3 + Regenerate).
 * Returns the message IDs of all sent messages (for cleanup on regenerate).
 */
export async function sendMealOptions(
  dishes: Dish[],
  imageUrls: string[]
): Promise<number[]> {
  const messageIds: number[] = [];
  // Greeting
  const greeting = `Hey David & Chika, here are some suggestions for meals this week:`;
  const greetRes = await callApi('sendMessage', {
    chat_id: chatId(),
    text: greeting,
  });
  messageIds.push(greetRes.result.message_id);

  // Send each photo individually with its dish name
  for (let i = 0; i < dishes.length; i++) {
    const d = dishes[i];
    const url = imageUrls[i];
    const servedLine = d.servedWith?.primary ? `\nBest with: ${d.servedWith.primary}` : '';
    if (url) {
      const photoRes = await callApi('sendPhoto', {
        chat_id: chatId(),
        photo: url,
        caption: `${i + 1}. ${d.name}\n${d.cuisine} — ${d.type}${servedLine}`,
      });
      messageIds.push(photoRes.result.message_id);
    } else {
      const msgRes = await callApi('sendMessage', {
        chat_id: chatId(),
        text: `${i + 1}. ${d.name}\n${d.cuisine} — ${d.type}${servedLine}`,
      });
      messageIds.push(msgRes.result.message_id);
    }
  }

  // Send pick message with inline keyboard (meal buttons + regenerate)
  const pickRes = await callApi('sendMessage', {
    chat_id: chatId(),
    text: `sunday. — tap to pick your meal this week:`,
    reply_markup: {
      inline_keyboard: [
        dishes.slice(0, 3).map((d, i) => ({
          text: `${i + 1}. ${d.name}`,
          callback_data: `pick:${i + 1}`,
        })),
        [{ text: '🔄 Regenerate', callback_data: 'regenerate' }],
      ],
    },
  });
  messageIds.push(pickRes.result.message_id);

  return messageIds;
}

/**
 * Delete a message by ID (used for cleanup on regenerate)
 */
export async function deleteMessage(messageId: number): Promise<void> {
  try {
    await callApi('deleteMessage', {
      chat_id: chatId(),
      message_id: messageId,
    });
  } catch (err) {
    // Telegram may reject deleting old messages (>48h) — not critical
    console.error(`Failed to delete message ${messageId}:`, err);
  }
}

/**
 * Send a simple text message, returns message ID
 */
export async function sendTextMessage(text: string): Promise<number> {
  const res = await callApi('sendMessage', {
    chat_id: chatId(),
    text,
  });
  return res.result.message_id;
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

// HTML-escape user-generated strings for Telegram parse_mode: 'HTML'
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Send cart summary with ingredient cross-check (replaces sendCartReady for enriched flow)
 */
export async function sendCartSummary(
  mappings: IngredientMapping[],
  itemCount: number
): Promise<void> {
  const recipeMatched = mappings.filter(m => m.upc && !m.isEssential);
  const recipeMissed = mappings.filter(m => !m.upc && !m.isEssential);
  const totalRecipe = recipeMatched.length + recipeMissed.length;

  let text = `sunday. — Cart ready! ${recipeMatched.length} of ${totalRecipe} recipe items matched.\n`;

  if (recipeMatched.length > 0) {
    text += `\n<b>Matched</b>\n`;
    for (const m of recipeMatched) {
      text += `  ${esc(m.searchTerm)} → ${esc(m.krogerProduct!)}${m.krogerBrand ? ` (${esc(m.krogerBrand)})` : ''}\n`;
    }
  }

  if (recipeMissed.length > 0) {
    text += `\n<b>Not found — grab these yourself</b>\n`;
    for (const m of recipeMissed) {
      text += `  ${esc(m.ingredient)}\n`;
    }
  }

  // Essentials summary (don't itemize, just count)
  const essentialsMatched = mappings.filter(m => m.upc && m.isEssential).length;
  const essentialsTotal = mappings.filter(m => m.isEssential).length;
  if (essentialsTotal > 0) {
    text += `\n+ ${essentialsMatched} of ${essentialsTotal} essentials added`;
  }

  text += `\n\nTap to checkout: https://www.qfc.com/cart`;

  // Telegram 4096 char limit — truncate matched list if needed
  if (text.length > 4096) {
    const overflow = text.length - 4000;
    const matchedSection = recipeMatched.map(
      m => `  ${esc(m.searchTerm)} → ${esc(m.krogerProduct!)}${m.krogerBrand ? ` (${esc(m.krogerBrand)})` : ''}\n`
    );
    // Remove lines from end of matched section to fit
    let removed = 0;
    while (matchedSection.length > 0 && removed < overflow) {
      removed += matchedSection.pop()!.length;
    }
    // Rebuild
    text = `sunday. — Cart ready! ${recipeMatched.length} of ${totalRecipe} recipe items matched.\n`;
    text += `\n<b>Matched</b>\n` + matchedSection.join('');
    text += `  ... and ${recipeMatched.length - matchedSection.length} more\n`;
    if (recipeMissed.length > 0) {
      text += `\n<b>Not found — grab these yourself</b>\n`;
      for (const m of recipeMissed) {
        text += `  ${esc(m.ingredient)}\n`;
      }
    }
    if (essentialsTotal > 0) {
      text += `\n+ ${essentialsMatched} of ${essentialsTotal} essentials added`;
    }
    text += `\n\nTap to checkout: https://www.qfc.com/cart`;
  }

  await callApi('sendMessage', {
    chat_id: chatId(),
    text,
    parse_mode: 'HTML',
  });
}

/**
 * Send recipe card (ingredients + cooking instructions) as Telegram message(s)
 */
export async function sendRecipeCard(
  dish: Dish,
  recipe: { ingredients: string[]; sections: RecipeSection[] }
): Promise<void> {
  const header = `<b>${esc(dish.name.toUpperCase())}</b>\n${esc(dish.cuisine)} — ${dish.difficulty} — ${esc(dish.prepTime)} — ${dish.servings} servings\n`;

  let ingredientBlock = `\n<b>Ingredients</b>\n`;
  for (const ing of recipe.ingredients) {
    ingredientBlock += `- ${esc(ing)}\n`;
  }

  let instructionBlock = '';
  let stepNum = 1;
  for (const section of recipe.sections) {
    instructionBlock += `\n<b>${esc(section.title)}</b>\n`;
    for (const step of section.steps) {
      const timeNote = step.time ? ` (${esc(step.time)})` : '';
      instructionBlock += `${String(stepNum).padStart(2, '0')}. ${esc(step.text)}${timeNote}\n`;
      stepNum++;
    }
  }

  const fullMessage = header + ingredientBlock + instructionBlock;

  if (fullMessage.length <= 4096) {
    await callApi('sendMessage', {
      chat_id: chatId(),
      text: fullMessage,
      parse_mode: 'HTML',
    });
  } else {
    // Split: ingredients first, then instructions
    await callApi('sendMessage', {
      chat_id: chatId(),
      text: header + ingredientBlock,
      parse_mode: 'HTML',
    });
    // Instructions may also need splitting by section
    let instrMsg = `<b>${esc(dish.name)} — Instructions</b>\n` + instructionBlock;
    if (instrMsg.length <= 4096) {
      await callApi('sendMessage', {
        chat_id: chatId(),
        text: instrMsg,
        parse_mode: 'HTML',
      });
    } else {
      // Send section by section
      let batch = `<b>${esc(dish.name)} — Instructions</b>\n`;
      stepNum = 1;
      for (const section of recipe.sections) {
        let sectionText = `\n<b>${esc(section.title)}</b>\n`;
        for (const step of section.steps) {
          const timeNote = step.time ? ` (${esc(step.time)})` : '';
          sectionText += `${String(stepNum).padStart(2, '0')}. ${esc(step.text)}${timeNote}\n`;
          stepNum++;
        }
        if (batch.length + sectionText.length > 4096) {
          await callApi('sendMessage', {
            chat_id: chatId(),
            text: batch,
            parse_mode: 'HTML',
          });
          batch = sectionText;
        } else {
          batch += sectionText;
        }
      }
      if (batch.trim()) {
        await callApi('sendMessage', {
          chat_id: chatId(),
          text: batch,
          parse_mode: 'HTML',
        });
      }
    }
  }
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
 * Send a sign-in button (inline keyboard with URL) for Kroger OAuth
 */
export async function sendSignInButton(oauthUrl: string): Promise<number> {
  const res = await callApi('sendMessage', {
    chat_id: chatId(),
    text: 'sunday. — Sign in to QFC to fill your cart:',
    reply_markup: {
      inline_keyboard: [[{ text: 'Sign in to QFC', url: oauthUrl }]],
    },
  });
  return res.result.message_id;
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
