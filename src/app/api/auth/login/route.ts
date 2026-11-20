import { login, sessionCookie } from '@/server/auth';
import { pool } from '@/server/db';
import { json, publicRoute } from '@/server/http';
import { loginBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/auth/login */
export const POST = publicRoute({ body: loginBody, ipRate: { limit: 20, windowSec: 60 } }, async ({ body, meta }) => {
  const { player, token, hasClan } = await login(body, meta, pool());
  return json({ player, hasClan }, 200, { 'set-cookie': sessionCookie(token) });
});
