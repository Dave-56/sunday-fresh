import { krogerRedirectUri, KROGER_AUTH_URL } from '../../../src/lib/krogerServer';

export async function GET() {
  const scopes = 'cart.basic:write product.compact profile.compact';
  const authorizeUrl =
    `${KROGER_AUTH_URL}/authorize?` +
    `scope=${encodeURIComponent(scopes)}` +
    `&response_type=code` +
    `&client_id=${encodeURIComponent(process.env.KROGER_CLIENT_ID || '')}` +
    `&redirect_uri=${encodeURIComponent(krogerRedirectUri())}`;

  return Response.json({ url: authorizeUrl });
}
