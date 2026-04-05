import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getClientToken, KROGER_API_BASE } from '../../_lib/krogerServer.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const term = (req.query.term as string) || '';
    const locationId = req.query.locationId as string;
    const limit = (req.query.limit as string) || '5';

    const token = await getClientToken();
    let url = `${KROGER_API_BASE}/products?filter.term=${encodeURIComponent(term)}&filter.limit=${limit}`;
    if (locationId) url += `&filter.locationId=${locationId}`;

    const apiRes = await fetch(url, {
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
