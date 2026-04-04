import {
  krogerBasicAuth,
  krogerRedirectUri,
  generateSessionId,
  setUserSession,
  KROGER_AUTH_URL,
} from '../../_lib/krogerServer';
import type { KVKrogerSession } from '../../_lib/kvSchema';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) return new Response('Missing authorization code', { status: 400 });

  try {
    const tokenRes = await fetch(`${KROGER_AUTH_URL}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${krogerBasicAuth()}`,
      },
      body:
        `grant_type=authorization_code` +
        `&code=${encodeURIComponent(code)}` +
        `&redirect_uri=${encodeURIComponent(krogerRedirectUri())}`,
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return new Response(`Token exchange failed: ${text}`, { status: tokenRes.status });
    }

    const data = await tokenRes.json();
    const sessionId = generateSessionId();
    const session: KVKrogerSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000 - 60_000,
    };

    await setUserSession(sessionId, session);

    const appUrl = process.env.APP_URL || '';
    return Response.redirect(`${appUrl}/?kroger_session=${sessionId}`);
  } catch (err: any) {
    return new Response(`OAuth error: ${err.message}`, { status: 500 });
  }
}
