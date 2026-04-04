import { getUserSession } from '../../../src/lib/krogerServer';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session');
  if (!sessionId) return Response.json({ authenticated: false });

  const session = await getUserSession(sessionId);
  return Response.json({ authenticated: !!session });
}
