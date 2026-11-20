import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';
import { buildSync } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/sync?cursor=<n> — realtime events since the cursor, plus the current resources and world clock. */
export const GET = playerRoute({}, async ({ viewer, query, now }) => {
  const raw = query.get('cursor');
  const cursor = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  return buildSync(pool(), viewer, cursor, now);
});
