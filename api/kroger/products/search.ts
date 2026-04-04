import { getClientToken, KROGER_API_BASE } from '../../_lib/krogerServer';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const term = searchParams.get('term') || '';
    const locationId = searchParams.get('locationId');
    const limit = searchParams.get('limit') || '5';

    const token = await getClientToken();
    let url = `${KROGER_API_BASE}/products?filter.term=${encodeURIComponent(term)}&filter.limit=${limit}`;
    if (locationId) url += `&filter.locationId=${locationId}`;

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
