import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getClientToken, KROGER_API_BASE } from '../_lib/krogerServer';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const zip = (req.query.zip as string) || '';
    const limit = (req.query.limit as string) || '5';

    const token = await getClientToken();
    const url = `${KROGER_API_BASE}/locations?filter.zipCode.near=${zip}&filter.limit=${limit}`;

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
