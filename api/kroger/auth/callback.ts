import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from '../../_lib/redis.js';
import {
  krogerBasicAuth,
  krogerRedirectUri,
  generateSessionId,
  setUserSession,
  KROGER_AUTH_URL,
} from '../../_lib/krogerServer.js';
import type { KVKrogerSession } from '../../_lib/kvSchema.js';
import { KV_TTL } from '../../_lib/kvSchema.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = req.query.code as string;
  if (!code) return res.status(400).send('Missing authorization code');

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
      return res.status(tokenRes.status).send(`Token exchange failed: ${text}`);
    }

    const data = await tokenRes.json();
    const sessionId = generateSessionId();
    const session: KVKrogerSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000 - 60_000,
    };

    await setUserSession(sessionId, session);

    // Store the session ID so the agent (twilio/incoming) can find it
    await redis.set('user:kroger_session_id', sessionId, {
      ex: KV_TTL.krogerSession,
    });

    const appUrl = process.env.APP_URL || '';
    return res.redirect(`${appUrl}/?kroger_session=${sessionId}`);
  } catch (err: any) {
    return res.status(500).send(`OAuth error: ${err.message}`);
  }
}
