import type { VercelRequest, VercelResponse } from '@vercel/node';
import { krogerRedirectUri, KROGER_AUTH_URL } from '../../_lib/krogerServer';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const scopes = 'cart.basic:write product.compact profile.compact';
  const authorizeUrl =
    `${KROGER_AUTH_URL}/authorize?` +
    `scope=${encodeURIComponent(scopes)}` +
    `&response_type=code` +
    `&client_id=${encodeURIComponent(process.env.KROGER_CLIENT_ID || '')}` +
    `&redirect_uri=${encodeURIComponent(krogerRedirectUri())}`;

  return res.json({ url: authorizeUrl });
}
