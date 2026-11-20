import type { ChatChannel } from '@/game/api';
import { WORLD } from '@/game/config';
import type { Membership } from './auth';
import { one } from './db';
import { conflict, invalid, notFound } from './errors';
import { clanRoom, emit, playerRoom, WORLD_ROOM } from './notify';
import type { G } from './world';

export interface ChatInput {
  channel?: ChatChannel;
  /** Recipient, for a private message. */
  to?: string;
  body: string;
}

/**
 * Post a chat message (chat:message).
 *
 *  - `world`: everyone.
 *  - `clan`: members of the sender's clan only.
 *  - `dm`: one other player, privately.
 *
 * Control characters are stripped and the length is capped. The event goes
 * only to the rooms allowed to read the message.
 */
export async function postChat(g: G, playerId: string, member: Membership | null, input: ChatInput): Promise<number> {
  const body = input.body.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!body) throw invalid('Write a message first');
  if (body.length > WORLD.maxChatLength) throw invalid(`Messages are limited to ${WORLD.maxChatLength} characters`);
  const channel = input.channel ?? 'world';

  if (channel === 'clan') {
    if (!member) throw conflict('NO_CLAN', 'Join a nation to use the nation channel');
    const row = await one<{ id: number }>(
      g.tx,
      `INSERT INTO chat_messages (channel, clan_id, player_id, body, created_at) VALUES ('clan', $1, $2, $3, $4) RETURNING id`,
      [member.clanId, playerId, body, g.now],
    );
    await markOwn(g, playerId, 'clan', row!.id);
    await emit(g, clanRoom(member.clanId), 'chat:message', { id: row!.id, channel: 'clan' });
    return row!.id;
  }

  if (channel === 'dm') {
    if (!input.to) throw invalid('Choose who to write to');
    if (input.to === playerId) throw invalid('You cannot write to yourself');
    const recipient = await one<{ id: string }>(g.tx, 'SELECT id FROM players WHERE id = $1', [input.to]);
    if (!recipient) throw notFound('Player');
    const row = await one<{ id: number }>(
      g.tx,
      `INSERT INTO chat_messages (channel, clan_id, player_id, recipient_player_id, body, created_at) VALUES ('dm', $1, $2, $3, $4, $5) RETURNING id`,
      [member?.clanId ?? null, playerId, recipient.id, body, g.now],
    );
    await markOwn(g, playerId, `dm:${recipient.id}`, row!.id);
    await emit(g, playerRoom(recipient.id), 'chat:message', { id: row!.id, channel: 'dm', with: playerId });
    await emit(g, playerRoom(playerId), 'chat:message', { id: row!.id, channel: 'dm', with: recipient.id });
    return row!.id;
  }

  const row = await one<{ id: number }>(
    g.tx,
    `INSERT INTO chat_messages (channel, clan_id, player_id, body, created_at) VALUES ('world', $1, $2, $3, $4) RETURNING id`,
    [member?.clanId ?? null, playerId, body, g.now],
  );
  await emit(g, WORLD_ROOM, 'chat:message', { id: row!.id, channel: 'world' });
  return row!.id;
}

/** Whoever writes in a thread has read it up to their own message. */
async function markOwn(g: G, playerId: string, thread: string, id: number): Promise<void> {
  await g.tx.query(
    `INSERT INTO chat_reads (player_id, thread, last_read_id) VALUES ($1, $2, $3)
     ON CONFLICT (player_id, thread) DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id)`,
    [playerId, thread, id],
  );
}
