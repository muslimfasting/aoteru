import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PlayerDTO } from '@/game/api';
import { CLAN_PERMISSIONS, type ClanPermission, type ClanRole } from '@/game/clan';
import { NAME_RULES, PORTRAITS } from '@/game/config';
import { one, withTx, type Db } from './db';
import { GameError, conflict, invalid } from './errors';
import { initPlayerPillars } from './progression';
import { openPurse } from './purse';
import type { ClanRow } from './rows';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'aoteru_session';
const SESSION_DAYS = 30;
const RESERVED = new Set(['admin', 'administrator', 'system', 'moderator', 'aoteru', 'shogun', 'npc', 'null', 'undefined']);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Only a hash of the session token is stored, so a database leak does not leak live sessions. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

async function createSession(db: Db, userId: string, meta: RequestMeta): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES ($1, $2, now() + ($3::text || ' days')::interval, $4, $5)`,
    [userId, hashToken(token), String(SESSION_DAYS), meta.ip, meta.userAgent?.slice(0, 300) ?? null],
  );
  return token;
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

export function validateNickname(nickname: string): string {
  const n = nickname.trim();
  const r = NAME_RULES.nickname;
  if (n.length < r.min || n.length > r.max) throw invalid(`Nickname must be ${r.min}-${r.max} characters`);
  if (!r.pattern.test(n)) throw invalid('Nickname may only use letters, numbers, hyphens and underscores');
  if (RESERVED.has(n.toLowerCase())) throw invalid('That nickname is reserved');
  return n;
}

function toPlayer(row: { id: string; nickname: string; email: string; portrait: string; created_at: Date }): PlayerDTO {
  return { id: row.id, nickname: row.nickname, email: row.email, portrait: row.portrait, createdAt: row.created_at.toISOString() };
}

export async function register(
  input: { email: string; password: string; nickname: string },
  meta: RequestMeta,
): Promise<{ player: PlayerDTO; token: string }> {
  if (process.env.REGISTRATION_CLOSED === 'true') throw new GameError('REGISTRATION_CLOSED', 'This world is not accepting new players', 403);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw invalid('Enter a valid email address');
  if (input.password.length < NAME_RULES.passwordMin) throw invalid(`Password must be at least ${NAME_RULES.passwordMin} characters`);
  if (input.password.length > 200) throw invalid('Password is too long');
  const nickname = validateNickname(input.nickname);
  const passwordHash = await hashPassword(input.password);

  return withTx(async (tx) => {
    if (await one(tx, 'SELECT 1 FROM users WHERE lower(email) = $1', [email])) {
      throw conflict('EMAIL_TAKEN', 'An account with that email already exists');
    }
    if (await one(tx, 'SELECT 1 FROM players WHERE lower(nickname) = $1', [nickname.toLowerCase()])) {
      throw conflict('NICKNAME_TAKEN', 'That nickname is already taken');
    }
    try {
      const user = await one<{ id: string }>(tx, 'INSERT INTO users (email, password_hash, last_login_at) VALUES ($1, $2, now()) RETURNING id', [
        email,
        passwordHash,
      ]);
      // A face to start with; it can be changed in the profile.
      const portrait = PORTRAITS[(nickname.length + nickname.charCodeAt(0)) % PORTRAITS.length].id;
      const player = await one<{ id: string; nickname: string; portrait: string; created_at: Date }>(
        tx,
        'INSERT INTO players (user_id, nickname, portrait) VALUES ($1, $2, $3) RETURNING id, nickname, portrait, created_at',
        [user!.id, nickname, portrait],
      );
      await initPlayerPillars(tx, player!.id);
      await openPurse(tx, player!.id);
      const token = await createSession(tx, user!.id, meta);
      await tx.query(`INSERT INTO audit_logs (actor_player_id, action, entity_type, entity_id, data, created_at) VALUES ($1::uuid, 'auth.register', 'player', $1::text, '{}', now())`, [
        player!.id,
      ]);
      return { player: toPlayer({ ...player!, email }), token };
    } catch (err: any) {
      // Two registrations racing for the same name: the unique indexes decide.
      if (err?.code === '23505') throw conflict('NAME_TAKEN', 'That email or nickname was just taken');
      throw err;
    }
  });
}

export async function login(input: { email: string; password: string }, meta: RequestMeta, db: Db): Promise<{ player: PlayerDTO; token: string; hasClan: boolean }> {
  const email = input.email.trim().toLowerCase();
  const row = await one<{ user_id: string; password_hash: string; id: string; nickname: string; portrait: string; created_at: Date; clan_status: string | null }>(
    db,
    `SELECT u.id AS user_id, u.password_hash, p.id, p.nickname, p.portrait, p.created_at, c.status AS clan_status
       FROM users u JOIN players p ON p.user_id = u.id
       LEFT JOIN clan_members m ON m.player_id = p.id LEFT JOIN clans c ON c.id = m.clan_id
      WHERE lower(u.email) = $1`,
    [email],
  );
  // Same answer for an unknown email and a wrong password.
  const ok = row ? await verifyPassword(input.password, row.password_hash) : false;
  if (!row || !ok) throw new GameError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
  const token = await createSession(db, row.user_id, meta);
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.user_id]);
  return { player: toPlayer({ ...row, email }), token, hasClan: row.clan_status === 'active' };
}

export async function logout(db: Db, token: string | null): Promise<void> {
  if (token) await db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
}

export interface Membership {
  clanId: string;
  role: ClanRole;
  /** What this member's role may do in the clan right now. */
  permissions: ClanPermission[];
  joinedAt: Date;
}

export interface Session {
  userId: string;
  player: PlayerDTO;
  /** The clan the player belongs to, if any (it may have fallen). */
  clan: ClanRow | null;
  member: Membership | null;
}

function reviveClan(raw: any): ClanRow {
  const date = (v: unknown) => (v ? new Date(v as string) : null);
  return {
    ...raw,
    protected_until: date(raw.protected_until),
    created_at: new Date(raw.created_at),
    doctrine_set_at: date(raw.doctrine_set_at),
    announcement_at: date(raw.announcement_at),
  };
}

/** Resolve a session token to the player, their clan and their role in it, in one query. */
export async function authenticate(db: Db, token: string | null): Promise<Session | null> {
  if (!token) return null;
  const row = await one<any>(
    db,
    `SELECT u.id AS user_id, u.email, p.id AS player_id, p.nickname, p.portrait, p.created_at AS player_created_at,
            to_jsonb(c.*) AS clan, m.role, m.joined_at,
            COALESCE((SELECT array_agg(rp.permission) FROM clan_role_permissions rp WHERE rp.clan_id = m.clan_id AND rp.role = m.role), '{}') AS permissions
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN players p ON p.user_id = u.id
       LEFT JOIN clan_members m ON m.player_id = p.id
       LEFT JOIN clans c ON c.id = m.clan_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!row) return null;
  const clan: ClanRow | null = row.clan ? reviveClan(row.clan) : null;
  const member: Membership | null = clan
    ? {
        clanId: clan.id,
        role: row.role,
        permissions: row.role === 'leader' ? [...CLAN_PERMISSIONS] : (row.permissions as ClanPermission[]),
        joinedAt: row.joined_at,
      }
    : null;
  return {
    userId: row.user_id,
    player: { id: row.player_id, nickname: row.nickname, email: row.email, portrait: row.portrait, createdAt: row.player_created_at.toISOString() },
    clan,
    member,
  };
}
