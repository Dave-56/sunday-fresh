import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from '../_lib/redis.js';
import { KV_KEYS, KV_TTL } from '../_lib/kvSchema.js';
import type { SyncPayload } from '../_lib/kvSchema.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body as SyncPayload;

    const ops: Promise<unknown>[] = [];

    if (body.preferences) {
      ops.push(redis.set(KV_KEYS.preferences, body.preferences));
    }

    if (body.history) {
      ops.push(redis.set(KV_KEYS.history, body.history));
    }

    if (body.krogerSession) {
      ops.push(
        redis.set(KV_KEYS.krogerSession, body.krogerSession, {
          ex: KV_TTL.krogerSession,
        })
      );
    }

    await Promise.all(ops);

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
