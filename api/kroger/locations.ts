import { getClientToken, KROGER_API_BASE } from '../../src/lib/krogerServer';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const zip = searchParams.get('zip') || '';
    const limit = searchParams.get('limit') || '5';

    const token = await getClientToken();
    const url = `${KROGER_API_BASE}/locations?filter.zipCode.near=${zip}&filter.limit=${limit}`;

    const apiRes = await fetch(url, {
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
