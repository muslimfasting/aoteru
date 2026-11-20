import { pool } from '@/server/db';
import { playerRoute } from '@/server/http';
import { markReadBody } from '@/server/schemas';
import { buildNotifications } from '@/server/views';

export const dynamic = 'force-dynamic';

/** POST /api/notifications/read — mark some (or, with no ids, all) notifications as read. */
export const POST = playerRoute({ body: markReadBody, skipAdvance: true }, async ({ viewer, body }) => {
  if (body.ids && body.ids.length > 0) {
    await pool().query('UPDATE notifications SET read_at = now() WHERE player_id = $1 AND read_at IS NULL AND id = ANY($2)', [viewer.player.id, body.ids]);
  } else {
    await pool().query('UPDATE notifications SET read_at = now() WHERE player_id = $1 AND read_at IS NULL', [viewer.player.id]);
  }
  return buildNotifications(pool(), viewer.player.id);
});
