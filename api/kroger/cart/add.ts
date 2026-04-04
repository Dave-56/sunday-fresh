import { getUserToken, KROGER_API_BASE } from '../../../src/lib/krogerServer';

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('session');
    if (!sessionId) return Response.json({ error: 'Missing session' }, { status: 401 });

    const token = await getUserToken(sessionId);
    const { items } = await req.json(); // [{ upc: string, quantity: number }]

    const apiRes = await fetch(`${KROGER_API_BASE}/cart/add`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ items }),
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      return Response.json({ error: text }, { status: apiRes.status });
    }

    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
