-- Clan-based play (change request v2.0).
--
-- A clan is no longer one player's kingdom: it has many members with roles and
-- configurable permissions, a shared treasury that members pay into, and its
-- own chat. Progression in the Five Pillars now belongs to the player, so it
-- travels with them from clan to clan. Existing worlds are carried over: every
-- clan's founder becomes its leader and keeps everything learned.

-- ------------------------------------------------------------- player profile

ALTER TABLE players
  ADD COLUMN portrait        text,
  ADD COLUMN residence_level integer NOT NULL DEFAULT 1 CHECK (residence_level BETWEEN 1 AND 10),
  -- The pillar this player trains at home: a little experience every hour.
  ADD COLUMN training_focus  text NOT NULL DEFAULT 'military',
  ADD COLUMN reputation      integer NOT NULL DEFAULT 0,
  ADD COLUMN battles_led     integer NOT NULL DEFAULT 0,
  ADD COLUMN battles_won     integer NOT NULL DEFAULT 0;

UPDATE players p SET portrait = c.portrait FROM clans c WHERE c.player_id = p.id;
UPDATE players SET portrait = 'general' WHERE portrait IS NULL;
ALTER TABLE players ALTER COLUMN portrait SET NOT NULL;
ALTER TABLE players ALTER COLUMN portrait SET DEFAULT 'general';

-- Personal purse (personal economy, §4.1).
CREATE TABLE player_resources (
  player_id  uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  gold       bigint NOT NULL DEFAULT 0 CHECK (gold >= 0),
  food       bigint NOT NULL DEFAULT 0 CHECK (food >= 0),
  wood       bigint NOT NULL DEFAULT 0 CHECK (wood >= 0),
  stone      bigint NOT NULL DEFAULT 0 CHECK (stone >= 0),
  iron       bigint NOT NULL DEFAULT 0 CHECK (iron >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO player_resources (player_id, gold, food, wood, stone, iron)
  SELECT id, 300, 200, 150, 100, 50 FROM players;

CREATE TABLE player_transactions (
  id            bigserial PRIMARY KEY,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  resource      text NOT NULL,
  amount        bigint NOT NULL,
  balance_after bigint NOT NULL,
  reason        text NOT NULL,
  ref_type      text,
  ref_id        text,
  created_at    timestamptz NOT NULL
);
CREATE INDEX player_transactions_player_idx ON player_transactions (player_id, id DESC);
CREATE TRIGGER player_transactions_immutable
  BEFORE UPDATE ON player_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

-- Five Pillars per player. NPC clans keep using five_pillars / player_skills.
CREATE TABLE player_pillars (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pillar    text NOT NULL,
  level     integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  xp        bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
  points    integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  PRIMARY KEY (player_id, pillar)
);
CREATE TABLE player_skill_ranks (
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  skill_code  text NOT NULL,
  rank        integer NOT NULL CHECK (rank >= 1),
  unlocked_at timestamptz NOT NULL,
  PRIMARY KEY (player_id, skill_code)
);

INSERT INTO player_pillars (player_id, pillar, level, xp, points)
  SELECT c.player_id, f.pillar, f.level, f.xp, f.points
    FROM five_pillars f JOIN clans c ON c.id = f.clan_id
   WHERE c.player_id IS NOT NULL;
INSERT INTO player_skill_ranks (player_id, skill_code, rank, unlocked_at)
  SELECT c.player_id, s.skill_code, s.rank, s.unlocked_at
    FROM player_skills s JOIN clans c ON c.id = s.clan_id
   WHERE c.player_id IS NOT NULL;
INSERT INTO player_pillars (player_id, pillar)
  SELECT p.id, x.pillar
    FROM players p CROSS JOIN (VALUES ('military'), ('leadership'), ('economy'), ('intelligence'), ('culture')) AS x(pillar)
  ON CONFLICT DO NOTHING;
DELETE FROM player_skills WHERE clan_id IN (SELECT id FROM clans WHERE player_id IS NOT NULL);
DELETE FROM five_pillars  WHERE clan_id IN (SELECT id FROM clans WHERE player_id IS NOT NULL);

-- ----------------------------------------------------------------- the clan

ALTER TABLE clans
  ADD COLUMN tag             text,
  ADD COLUMN description     text NOT NULL DEFAULT '',
  ADD COLUMN recruitment     text NOT NULL DEFAULT 'application'
    CHECK (recruitment IN ('open', 'application', 'invite', 'closed')),
  ADD COLUMN language        text NOT NULL DEFAULT 'en',
  ADD COLUMN doctrine        text CHECK (doctrine IN ('aggressive', 'defensive', 'intelligence', 'diplomatic')),
  ADD COLUMN doctrine_set_at timestamptz,
  ADD COLUMN announcement    text,
  ADD COLUMN announcement_at timestamptz,
  ADD COLUMN announcement_by uuid REFERENCES players(id) ON DELETE SET NULL;

-- `clans.player_id` now means "the leader". A clan whose last member left is
-- disbanded and has no leader; its name and tag become free again.
ALTER TABLE clans DROP CONSTRAINT clans_status_check;
ALTER TABLE clans ADD CONSTRAINT clans_status_check CHECK (status IN ('active', 'fallen', 'disbanded'));
ALTER TABLE clans DROP CONSTRAINT clans_check;
ALTER TABLE clans ADD CONSTRAINT clans_leader_check CHECK (is_npc OR player_id IS NOT NULL OR status = 'disbanded');
DROP INDEX clans_name_key;
CREATE UNIQUE INDEX clans_name_key ON clans (lower(name)) WHERE status <> 'disbanded';

DO $$
DECLARE
  c record;
  base text;
  candidate text;
  n integer;
BEGIN
  FOR c IN SELECT id, name FROM clans ORDER BY created_at, id LOOP
    base := upper(left(regexp_replace(c.name, '[^A-Za-z0-9]', '', 'g'), 4));
    IF length(base) < 2 THEN base := 'CLAN'; END IF;
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM clans WHERE upper(tag) = candidate) LOOP
      n := n + 1;
      candidate := left(base, 3) || n::text;
    END LOOP;
    UPDATE clans SET tag = candidate WHERE id = c.id;
  END LOOP;
END
$$;
ALTER TABLE clans ALTER COLUMN tag SET NOT NULL;
CREATE UNIQUE INDEX clans_tag_key ON clans (upper(tag)) WHERE status <> 'disbanded';

-- A player belongs to at most one clan at a time (the primary key).
CREATE TABLE clan_members (
  player_id    uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  clan_id      uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  role         text NOT NULL
    CHECK (role IN ('leader', 'officer', 'general', 'strategist', 'intelligence', 'treasurer', 'samurai', 'recruit')),
  joined_at    timestamptz NOT NULL,
  -- Weighted value of everything this member has paid into the treasury.
  contribution bigint NOT NULL DEFAULT 0
);
CREATE INDEX clan_members_clan_idx ON clan_members (clan_id);
CREATE UNIQUE INDEX clan_members_leader_key ON clan_members (clan_id) WHERE role = 'leader';

INSERT INTO clan_members (player_id, clan_id, role, joined_at)
  SELECT player_id, id, 'leader', created_at FROM clans WHERE player_id IS NOT NULL;

-- What each role may do, per clan. The leader always may do everything.
CREATE TABLE clan_role_permissions (
  clan_id    uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  role       text NOT NULL,
  permission text NOT NULL,
  PRIMARY KEY (clan_id, role, permission)
);
INSERT INTO clan_role_permissions (clan_id, role, permission)
  SELECT c.id, d.role, d.permission
    FROM clans c
    CROSS JOIN (VALUES
      ('officer', 'manage_members'), ('officer', 'manage_clan'), ('officer', 'build'), ('officer', 'recruit'),
      ('officer', 'command'), ('officer', 'war_plans'), ('officer', 'diplomacy'), ('officer', 'espionage'),
      ('general', 'recruit'), ('general', 'command'), ('general', 'war_plans'),
      ('strategist', 'war_plans'),
      ('intelligence', 'espionage'),
      ('treasurer', 'treasury'), ('treasurer', 'build')
    ) AS d(role, permission)
   WHERE NOT c.is_npc;

CREATE TABLE clan_applications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id    uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  message    text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz NOT NULL,
  decided_by uuid REFERENCES players(id) ON DELETE SET NULL,
  decided_at timestamptz
);
CREATE UNIQUE INDEX clan_applications_pending_key ON clan_applications (clan_id, player_id) WHERE status = 'pending';
CREATE INDEX clan_applications_player_idx ON clan_applications (player_id) WHERE status = 'pending';

CREATE TABLE clan_invitations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id    uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES players(id) ON DELETE SET NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz NOT NULL,
  decided_at timestamptz
);
CREATE UNIQUE INDEX clan_invitations_pending_key ON clan_invitations (clan_id, player_id) WHERE status = 'pending';
CREATE INDEX clan_invitations_player_idx ON clan_invitations (player_id) WHERE status = 'pending';

-- Running totals of what each member has paid in, per resource.
CREATE TABLE clan_contributions (
  clan_id   uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  resource  text NOT NULL,
  amount    bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (clan_id, player_id, resource)
);

-- Who caused a treasury movement (deposits, withdrawals, orders paid from the treasury).
ALTER TABLE transactions ADD COLUMN actor_player_id uuid;

-- Clan activity history: joins, departures, promotions, deposits, withdrawals.
CREATE TABLE clan_activity (
  id              bigserial PRIMARY KEY,
  clan_id         uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  actor_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  type            text NOT NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL
);
CREATE INDEX clan_activity_clan_idx ON clan_activity (clan_id, id DESC);

-- The member who led an army out; their Military pillar is used in its battles.
ALTER TABLE armies ADD COLUMN commander_player_id uuid REFERENCES players(id) ON DELETE SET NULL;

-- --------------------------------------------------------------------- chat

-- Channels: 'world' (everyone), 'clan' (members of clan_id), 'dm' (player_id -> recipient_player_id).
ALTER TABLE chat_messages ADD COLUMN recipient_player_id uuid REFERENCES players(id) ON DELETE CASCADE;
CREATE INDEX chat_messages_clan_idx ON chat_messages (clan_id, id DESC) WHERE channel = 'clan';
CREATE INDEX chat_messages_dm_idx
  ON chat_messages (LEAST(player_id, recipient_player_id), GREATEST(player_id, recipient_player_id), id DESC)
  WHERE channel = 'dm';
CREATE INDEX chat_messages_dm_recipient_idx ON chat_messages (recipient_player_id, id DESC) WHERE channel = 'dm';

-- How far each player has read: thread is 'clan' or 'dm:<other player id>'.
CREATE TABLE chat_reads (
  player_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  thread       text NOT NULL,
  last_read_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, thread)
);

-- New tables are reached only through the game server, like the rest.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;
