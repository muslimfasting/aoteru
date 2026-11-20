/**
 * Helpers for routes that answer with the caller's refreshed view after a
 * change to their clan membership (the session read at the start of the
 * request no longer describes them).
 */
import type { ClanHubResponse, MeResponse } from '@/game/api';
import { authenticate, readSessionToken } from './auth';
import { buildClanHub } from './clanviews';
import { pool } from './db';
import { GameError } from './errors';
import { buildMe, type Viewer } from './views';

export async function freshViewer(req: Request): Promise<Viewer> {
  const fresh = await authenticate(pool(), readSessionToken(req.headers.get('cookie')));
  if (!fresh) throw new GameError('UNAUTHENTICATED', 'Please log in', 401);
  return { player: fresh.player, clan: fresh.clan, member: fresh.member };
}

export async function freshMe(req: Request, now: Date): Promise<MeResponse> {
  return buildMe(pool(), await freshViewer(req), now);
}

export async function freshHub(req: Request, now: Date): Promise<ClanHubResponse> {
  return buildClanHub(pool(), await freshViewer(req), now);
}
