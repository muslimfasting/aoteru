import { buildPlayerSearch } from '@/server/clanviews';
import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/players?search=<text> — find players to message or invite. */
export const GET = playerRoute({ skipAdvance: true }, async ({ viewer, query }) => buildPlayerSearch(pool(), viewer, query.get('search') ?? ''));
