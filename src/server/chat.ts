import { WORLD } from '@/game/config';
import { one } from './db';
import { invalid } from './errors';
import { emit, WORLD_ROOM } from './notify';
import type { G } from './world';

/** Post to the world channel (chat:message). Control characters are stripped; length is capped. */
export async function postChat(g: G, playerId: string, clanId: string | null, bodyInput: string): Promise<number> {
  const body = bodyInput.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!body) throw invalid('Write a message first');
  if (body.length > WORLD.maxChatLength) throw invalid(`Messages are limited to ${WORLD.maxChatLength} characters`);
  const row = await one<{ id: number }>(
    g.tx,
    `INSERT INTO chat_messages (channel, clan_id, player_id, body, created_at) VALUES ('world', $1, $2, $3, $4) RETURNING id`,
    [clanId, playerId, body, g.now],
  );
  await emit(g, WORLD_ROOM, 'chat:message', { id: row!.id });
  return row!.id;
}
