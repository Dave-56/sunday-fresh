import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserSession } from '../../_lib/krogerServer';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sessionId = req.query.session as string;
  if (!sessionId) return res.json({ authenticated: false });

  const session = await getUserSession(sessionId);
  return res.json({ authenticated: !!session });
}
