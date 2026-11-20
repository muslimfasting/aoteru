import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';
import { buildNotifications } from '@/server/views';

export const dynamic = 'force-dynamic';

/** GET /api/notifications */
export const GET = playerRoute({ skipAdvance: true }, async ({ viewer }) => buildNotifications(pool(), viewer.player.id));
