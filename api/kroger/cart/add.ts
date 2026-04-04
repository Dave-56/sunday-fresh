import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserToken, KROGER_API_BASE } from '../../_lib/krogerServer';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionId = req.query.session as string;
    if (!sessionId) return res.status(401).json({ error: 'Missing session' });

    const token = await getUserToken(sessionId);
    const { items } = req.body; // [{ upc: string, quantity: number }]

    const apiRes = await fetch(`${KROGER_API_BASE}/cart/add`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ items }),
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      return res.status(apiRes.status).json({ error: text });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
