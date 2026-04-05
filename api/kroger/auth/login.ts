import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildOAuthUrl } from '../../_lib/krogerServer.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authorizeUrl = await buildOAuthUrl({
    source: 'web',
    selection: null,
    dish: null,
    createdAt: Date.now(),
  });

  return res.json({ url: authorizeUrl });
}
