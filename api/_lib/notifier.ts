import type { Dish } from './types';
import * as twilio from './twilio';
import * as telegram from './telegram';

function channel(): 'telegram' | 'twilio' {
  const ch = process.env.NOTIFICATION_CHANNEL || 'telegram';
  return ch === 'twilio' ? 'twilio' : 'telegram';
}

export async function sendMealOptions(
  dishes: Dish[],
  imageUrls: string[]
): Promise<void> {
  if (channel() === 'twilio') {
    await twilio.sendMealOptions(dishes, imageUrls);
  } else {
    await telegram.sendMealOptions(dishes, imageUrls);
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
