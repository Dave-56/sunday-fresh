import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserToken, KROGER_API_BASE } from '../_lib/krogerServer';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sessionId = req.query.session as string;
    if (!sessionId) return res.status(401).json({ error: 'Missing session' });

    const token = await getUserToken(sessionId);
    const apiRes = await fetch(`${KROGER_API_BASE}/identity/profile`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      return res.status(apiRes.status).json({ error: text });
    }

    const data = await apiRes.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
