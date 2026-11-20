import { register, sessionCookie } from '@/server/auth';
import { json, publicRoute } from '@/server/http';
import { registerBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/auth/register — create an account and start a session. */
export const POST = publicRoute({ body: registerBody, ipRate: { limit: 10, windowSec: 60 } }, async ({ body, meta }) => {
  const { player, token } = await register(body, meta);
  return json({ player, hasClan: false }, 200, { 'set-cookie': sessionCookie(token) });
});
