import { clearedSessionCookie, logout, readSessionToken } from '@/server/auth';
import { pool } from '@/server/db';
import { json, publicRoute } from '@/server/http';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — revoke the session server-side and clear the cookie. */
export const POST = publicRoute({}, async ({ req }) => {
  await logout(pool(), readSessionToken(req.headers.get('cookie')));
  return json({ ok: true }, 200, { 'set-cookie': clearedSessionCookie() });
});
