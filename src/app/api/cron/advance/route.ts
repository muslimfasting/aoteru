import { advanceWorld } from '@/server/advance';
import { GameError } from '@/server/errors';
import { publicRoute } from '@/server/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/advance — the world simulation worker entry point.
 *
 * Call it on a schedule (Vercel Cron, or any external scheduler) with
 * `Authorization: Bearer <CRON_SECRET>`. It processes everything that is due
 * and returns; overlapping calls are harmless because only one can hold the
 * world lock.
 */
export const GET = publicRoute({}, async ({ req }) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new GameError('NOT_CONFIGURED', 'CRON_SECRET is not set', 503);
  if (req.headers.get('authorization') !== `Bearer ${secret}`) throw new GameError('FORBIDDEN', 'Invalid cron secret', 403);
  const result = await advanceWorld({ budgetMs: 45_000, blocking: false });
  return { ok: true, ...result };
});
