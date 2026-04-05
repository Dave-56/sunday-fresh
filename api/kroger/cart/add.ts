import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserToken, KROGER_API_BASE } from '../../_lib/krogerServer.js';

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

    // Log response structure for investigation (not raw payload)
    let cartResponse: unknown = null;
    try {
      cartResponse = await apiRes.json();
      const keys = cartResponse && typeof cartResponse === 'object'
        ? Object.keys(cartResponse)
        : [];
      console.log('Kroger cart response:', {
        status: apiRes.status,
        itemsSubmitted: items?.length,
        responseKeys: keys,
      });
    } catch {
      console.log('Kroger cart response:', { status: apiRes.status, itemsSubmitted: items?.length });
    }

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: 'Cart add failed', status: apiRes.status });
    }

    return res.json({ success: true, itemCount: items?.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
