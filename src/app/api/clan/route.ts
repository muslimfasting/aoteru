import { buildClanHub } from '@/server/clanviews';
import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/clan — the viewer's own clan: members, treasury, applications, permissions, history. */
export const GET = playerRoute({}, async ({ viewer, now }) => buildClanHub(pool(), viewer, now));
