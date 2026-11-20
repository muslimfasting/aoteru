import { pool } from '@/server/db';
import { clanRoute } from '@/server/http';
import { buildWarCouncil } from '@/server/warviews';

export const dynamic = 'force-dynamic';

/** GET /api/war — the clan's war council: plans, assignments and what each plan would take. */
export const GET = clanRoute({}, async ({ viewer, now }) => buildWarCouncil(pool(), viewer, now));
