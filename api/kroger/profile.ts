import { getUserToken, KROGER_API_BASE } from '../../src/lib/krogerServer';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('session');
    if (!sessionId) return Response.json({ error: 'Missing session' }, { status: 401 });

    const token = await getUserToken(sessionId);
    const apiRes = await fetch(`${KROGER_API_BASE}/identity/profile`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      return Response.json({ error: text }, { status: apiRes.status });
    }

    const data = await apiRes.json();
    return Response.json(data);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
