import { pool } from '@/server/db';
import { assertUuid } from '@/server/errors';
import { playerRoute } from '@/server/http';
import { buildProvince } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/provinces/:id — province details, as far as the viewer is allowed to see. */
export const GET = playerRoute({}, async ({ viewer, params, now }) => buildProvince(pool(), viewer, assertUuid(params.id, 'province id'), now));
