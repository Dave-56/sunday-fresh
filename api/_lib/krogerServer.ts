import { redis } from './redis';
import { KV_KEYS, KV_TTL } from './kvSchema';
import type { KVKrogerSession } from './kvSchema';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const KROGER_API_BASE = 'https://api.kroger.com/v1';
const KROGER_AUTH_URL = `${KROGER_API_BASE}/connect/oauth2`;

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export function krogerBasicAuth(): string {
  return Buffer.from(
    `${env('KROGER_CLIENT_ID')}:${env('KROGER_CLIENT_SECRET')}`
  ).toString('base64');
}

export function krogerRedirectUri(): string {
  return (
    process.env.KROGER_REDIRECT_URI ||
    `${env('APP_URL')}/api/kroger/auth/callback`
  );
}

// ---------------------------------------------------------------------------
// Client-credentials token (product search, locations — no user auth needed)
// ---------------------------------------------------------------------------
const CLIENT_TOKEN_KEY = 'kroger:client_token';

interface ClientToken {
  access_token: string;
  expires_at: number;
}

export async function getClientToken(): Promise<string> {
  const cached = await redis.get<ClientToken>(CLIENT_TOKEN_KEY);
  if (cached && Date.now() < cached.expires_at) return cached.access_token;

  const res = await fetch(`${KROGER_AUTH_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${krogerBasicAuth()}`,
    },
    body: 'grant_type=client_credentials&scope=product.compact',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kroger client token failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const token: ClientToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
  };
  await redis.set(CLIENT_TOKEN_KEY, token, { ex: data.expires_in - 60 });
  return token.access_token;
}

// ---------------------------------------------------------------------------
// User tokens (cart, profile — requires OAuth session)
// ---------------------------------------------------------------------------
export async function getUserSession(
  sessionId: string
): Promise<KVKrogerSession | null> {
  return redis.get<KVKrogerSession>(`${KV_KEYS.krogerSession}:${sessionId}`);
}

export async function setUserSession(
  sessionId: string,
  session: KVKrogerSession
): Promise<void> {
  await redis.set(`${KV_KEYS.krogerSession}:${sessionId}`, session, {
    ex: KV_TTL.krogerSession,
  });
}

export async function deleteUserSession(sessionId: string): Promise<void> {
  await redis.del(`${KV_KEYS.krogerSession}:${sessionId}`);
}

export async function getUserToken(sessionId: string): Promise<string> {
  const session = await getUserSession(sessionId);
  if (!session) throw new Error('Not authenticated with Kroger');

  if (Date.now() < session.expires_at) return session.access_token;

  // Refresh
  const res = await fetch(`${KROGER_AUTH_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${krogerBasicAuth()}`,
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refresh_token)}`,
  });

  if (!res.ok) {
    await deleteUserSession(sessionId);
    throw new Error('Refresh token expired — user must re-authenticate');
  }

  const data = await res.json();
  const updated: KVKrogerSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
  };
  await setUserSession(sessionId, updated);
  return updated.access_token;
}

export function generateSessionId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// Convenience: Kroger API base URL
// ---------------------------------------------------------------------------
export { KROGER_API_BASE, KROGER_AUTH_URL, redis };
