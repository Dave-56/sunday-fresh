import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { redis } from '../../_lib/redis.js';
import {
  krogerBasicAuth,
  krogerRedirectUri,
  generateSessionId,
  setUserSession,
  deleteUserSession,
  getUserToken,
  peekOAuthState,
  consumeOAuthState,
  KROGER_AUTH_URL,
} from '../../_lib/krogerServer.js';
import { fillCart } from '../../_lib/handleMealSelection.js';
import { sendCartReady, sendError } from '../../_lib/telegram.js';
import { KV_KEYS, KV_TTL } from '../../_lib/kvSchema.js';
import type { KVKrogerSession, KVPreferences, KVOAuthState } from '../../_lib/kvSchema.js';

export const config = { maxDuration: 60 };

// Inline "Done" HTML page for Telegram flow
const SIGNED_IN_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>sunday. — Signed in</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#fdfaf6;color:#111;
padding:2rem;max-width:640px;margin:0 auto;line-height:1.7;display:flex;flex-direction:column;
justify-content:center;min-height:100vh;text-align:center}
h1{font-size:1.5rem;margin-bottom:1rem}
p{font-size:0.95rem;opacity:0.8;margin-bottom:1.5rem}
a{display:inline-block;padding:0.75rem 1.5rem;background:#111;color:#fdfaf6;
text-decoration:none;border-radius:8px;font-size:0.95rem}
a:hover{opacity:0.85}
</style>
</head><body>
<div>
<h1>You're signed in.</h1>
<p>Filling your cart now — check Telegram for confirmation.</p>
<a href="https://t.me/${process.env.TELEGRAM_BOT_USERNAME || ''}">Open Telegram</a>
</div>
</body></html>`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = req.query.code as string;
  const stateNonce = req.query.state as string;

  if (!code) return res.status(400).send('Missing authorization code');

  // --- CSRF / state validation ---
  if (!stateNonce) return res.status(400).send('Missing state parameter');

  const peeked = await peekOAuthState(stateNonce);
  if (!peeked) {
    return res.status(400).send('Invalid or expired state — tap the sign-in button again in Telegram.');
  }

  // --- Token exchange ---
  let data: any;
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
      // Don't consume state — user can retry if Kroger had a transient failure
      return res.status(tokenRes.status).send(`Token exchange failed: ${text}`);
    }

    data = await tokenRes.json();
  } catch (err: any) {
    return res.status(500).send(`OAuth error: ${err.message}`);
  }

  // --- Consume state (atomic — safe now that token exchange succeeded) ---
  const oauthState = await consumeOAuthState(stateNonce);
  if (!oauthState) {
    // Race / double-click: state was consumed between peek and here.
    // Don't leave orphaned session — we haven't stored one yet, so just bail.
    return res.status(400).send('Session already used — check Telegram for your confirmation.');
  }

  // --- Store session ---
  const sessionId = generateSessionId();
  const session: KVKrogerSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
  };

  await setUserSession(sessionId, session);
  await redis.set(KV_KEYS.krogerSessionPointer, sessionId, {
    ex: KV_TTL.krogerSession,
  });

  // --- Branch on source ---
  if (oauthState.source === 'telegram' && oauthState.dish) {
    // Return HTML immediately, fill cart in background
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(SIGNED_IN_HTML);

    waitUntil(
      telegramAutoFill(oauthState, sessionId)
    );
  } else {
    // Web flow — redirect to app
    const appUrl = process.env.APP_URL || '';
    return res.redirect(`${appUrl}/?kroger_session=${sessionId}`);
  }
}

async function telegramAutoFill(
  oauthState: KVOAuthState,
  sessionId: string
): Promise<void> {
  try {
    const preferences = await redis.get<KVPreferences>(KV_KEYS.preferences);
    if (!preferences) {
      await sendError('Signed in, but preferences not found — open the app to set up first.');
      return;
    }

    const userToken = await getUserToken(sessionId);
    const result = await fillCart(oauthState.dish!, preferences, userToken);

    if (result.ok) {
      await sendCartReady(result.itemCount);
      // Clear pending meals
      await redis.del(KV_KEYS.pendingMeals);
    } else {
      await sendError('Signed in, but cart fill failed. Tap the meal button again.');
    }
  } catch (err: any) {
    console.error('Telegram auto-fill error:', err);
    // If token just became invalid, clean up
    if (err.message?.includes('Not authenticated') || err.message?.includes('re-authenticate')) {
      await deleteUserSession(sessionId);
      await redis.del(KV_KEYS.krogerSessionPointer);
    }
    try {
      await sendError('Signed in, but cart fill failed. Tap the meal button again.');
    } catch (_) {}
  }
}
