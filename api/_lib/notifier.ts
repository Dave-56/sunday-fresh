import type { Dish } from './types.js';
import * as twilio from './twilio.js';
import * as telegram from './telegram.js';

function channel(): 'telegram' | 'twilio' {
  const ch = process.env.NOTIFICATION_CHANNEL || 'telegram';
  return ch === 'twilio' ? 'twilio' : 'telegram';
}

export async function sendMealOptions(
  dishes: Dish[],
  imageUrls: string[]
): Promise<number[]> {
  if (channel() === 'twilio') {
    await twilio.sendMealOptions(dishes, imageUrls);
    return []; // Twilio doesn't return message IDs we track
  } else {
    return telegram.sendMealOptions(dishes, imageUrls);
  }
}

export async function sendCartReady(itemCount: number): Promise<void> {
  if (channel() === 'twilio') {
    await twilio.sendCartReady(itemCount);
  } else {
    await telegram.sendCartReady(itemCount);
  }
}

export async function sendError(message: string): Promise<void> {
  if (channel() === 'twilio') {
    await twilio.sendError(message);
  } else {
    await telegram.sendError(message);
  }
}
