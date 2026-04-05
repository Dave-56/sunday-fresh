import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from '../_lib/redis.js';
import { KV_KEYS } from '../_lib/kvSchema.js';
import type { KVActiveRecipe } from '../_lib/kvSchema.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const data = await redis.get<KVActiveRecipe>(KV_KEYS.activeRecipe);
  if (!data) {
    return res.status(404).json({ error: 'No active recipe' });
  }

  return res.json(data);
}
