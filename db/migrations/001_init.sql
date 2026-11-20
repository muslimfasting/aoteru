-- Aoteru: Rise of Japan — initial schema.
-- UUID identifiers, integer resource values, foreign keys, unique ownership and
-- membership constraints, and an immutable economic ledger (GDD §14).

-- ---------------------------------------------------------------- identity

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip         text,
  user_agent text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE players (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  nickname   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX players_nickname_key ON players (lower(nickname));

-- ------------------------------------------------------------------- world

CREATE TABLE regions (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  kanji    text NOT NULL,
  identity text NOT NULL,
  playable boolean NOT NULL DEFAULT false
);

CREATE TABLE clans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           uuid UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  npc_key             text UNIQUE,
  name                text NOT NULL,
  daimyo_name         text NOT NULL,
  portrait            text NOT NULL,
  banner_color        text NOT NULL,
  banner_mon          text NOT NULL,
  is_npc              boolean NOT NULL DEFAULT false,
  personality         text,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fallen')),
  capital_province_id uuid,
  protected_until     timestamptz,
  starving_ticks      integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (is_npc OR player_id IS NOT NULL)
);
CREATE UNIQUE INDEX clans_name_key ON clans (lower(name));
-- Every active clan flies a distinct colour so the map stays readable.
CREATE UNIQUE INDEX clans_active_color_key ON clans (banner_color) WHERE status = 'active';

CREATE TABLE provinces (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  name              text NOT NULL,
  region_id         text NOT NULL REFERENCES regions(id),
  -- One primary owner per province (GDD §2.4).
  owner_clan_id     uuid REFERENCES clans(id),
  terrain           text NOT NULL,
  population        integer NOT NULL CHECK (population >= 0),
  base_food         integer NOT NULL,
  base_gold         integer NOT NULL,
  base_wood         integer NOT NULL,
  base_stone        integer NOT NULL,
  base_iron         integer NOT NULL,
  defense_level     integer NOT NULL DEFAULT 1,
  development_level integer NOT NULL DEFAULT 0,
  loyalty           numeric(5, 2) NOT NULL DEFAULT 50 CHECK (loyalty BETWEEN 0 AND 100),
  is_start_slot     boolean NOT NULL DEFAULT false,
  last_festival_at  timestamptz,
  owner_since       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provinces_owner_idx ON provinces (owner_clan_id);

ALTER TABLE clans
  ADD CONSTRAINT clans_capital_fk FOREIGN KEY (capital_province_id) REFERENCES provinces(id);

-- Every ownership change is recorded (GDD §2.4).
CREATE TABLE province_ownership_history (
  id           bigserial PRIMARY KEY,
  province_id  uuid NOT NULL REFERENCES provinces(id),
  from_clan_id uuid REFERENCES clans(id),
  to_clan_id   uuid REFERENCES clans(id),
  reason       text NOT NULL,
  battle_id    uuid,
  created_at   timestamptz NOT NULL
);
CREATE INDEX province_ownership_history_province_idx ON province_ownership_history (province_id, id DESC);

CREATE TABLE buildings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  province_id          uuid NOT NULL REFERENCES provinces(id) ON DELETE CASCADE,
  type                 text NOT NULL,
  level                integer NOT NULL DEFAULT 0 CHECK (level >= 0),
  upgrade_started_at   timestamptz,
  upgrade_completes_at timestamptz,
  UNIQUE (province_id, type)
);
CREATE INDEX buildings_due_idx ON buildings (upgrade_completes_at) WHERE upgrade_completes_at IS NOT NULL;

-- ----------------------------------------------------------------- economy

CREATE TABLE resources (
  clan_id    uuid PRIMARY KEY REFERENCES clans(id),
  gold       bigint NOT NULL DEFAULT 0 CHECK (gold >= 0),
  food       bigint NOT NULL DEFAULT 0 CHECK (food >= 0),
  wood       bigint NOT NULL DEFAULT 0 CHECK (wood >= 0),
  stone      bigint NOT NULL DEFAULT 0 CHECK (stone >= 0),
  iron       bigint NOT NULL DEFAULT 0 CHECK (iron >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Economic ledger: every change to a balance, with the balance it produced.
CREATE TABLE transactions (
  id            bigserial PRIMARY KEY,
  clan_id       uuid NOT NULL REFERENCES clans(id),
  resource      text NOT NULL,
  amount        bigint NOT NULL,
  balance_after bigint NOT NULL,
  reason        text NOT NULL,
  ref_type      text,
  ref_id        text,
  created_at    timestamptz NOT NULL
);
CREATE INDEX transactions_clan_idx ON transactions (clan_id, id DESC);

CREATE FUNCTION forbid_ledger_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the transactions ledger is immutable';
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

-- ---------------------------------------------------------------- military

CREATE TABLE armies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL: local warriors holding an unclaimed province.
  clan_id            uuid REFERENCES clans(id),
  -- Where the army stands; the province it set out from while marching.
  province_id        uuid NOT NULL REFERENCES provinces(id),
  status             text NOT NULL CHECK (status IN ('garrison', 'marching', 'besieging')),
  intent             text CHECK (intent IN ('move', 'attack', 'return')),
  target_province_id uuid REFERENCES provinces(id),
  path               jsonb,
  departed_at        timestamptz,
  arrives_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- A clan keeps a single garrison per province; arriving troops merge into it.
CREATE UNIQUE INDEX armies_garrison_key ON armies (province_id, clan_id)
  WHERE status = 'garrison' AND clan_id IS NOT NULL;
CREATE UNIQUE INDEX armies_neutral_garrison_key ON armies (province_id)
  WHERE status = 'garrison' AND clan_id IS NULL;
CREATE INDEX armies_due_idx ON armies (arrives_at) WHERE status = 'marching';
CREATE INDEX armies_clan_idx ON armies (clan_id);

CREATE TABLE army_units (
  army_id   uuid NOT NULL REFERENCES armies(id) ON DELETE CASCADE,
  unit_type text NOT NULL,
  count     integer NOT NULL CHECK (count >= 0),
  PRIMARY KEY (army_id, unit_type)
);

CREATE TABLE recruitment_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id      uuid NOT NULL REFERENCES clans(id),
  province_id  uuid NOT NULL REFERENCES provinces(id),
  unit_type    text NOT NULL,
  count        integer NOT NULL CHECK (count > 0),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
  started_at   timestamptz NOT NULL,
  completes_at timestamptz NOT NULL
);
CREATE INDEX recruitment_due_idx ON recruitment_orders (completes_at) WHERE status = 'pending';
CREATE INDEX recruitment_clan_idx ON recruitment_orders (clan_id) WHERE status = 'pending';

-- ------------------------------------------------------------- progression

CREATE TABLE five_pillars (
  clan_id uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  pillar  text NOT NULL,
  level   integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  xp      bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
  points  integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  PRIMARY KEY (clan_id, pillar)
);

-- Skill definitions live in code (src/game/pillars.ts); this stores what each Daimyo has learned.
CREATE TABLE player_skills (
  clan_id     uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  skill_code  text NOT NULL,
  rank        integer NOT NULL CHECK (rank >= 1),
  unlocked_at timestamptz NOT NULL,
  PRIMARY KEY (clan_id, skill_code)
);

-- --------------------------------------------------------------- diplomacy

CREATE TABLE wars (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_clan_id uuid NOT NULL REFERENCES clans(id),
  defender_clan_id uuid NOT NULL REFERENCES clans(id),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  declared_at      timestamptz NOT NULL,
  ended_at         timestamptz,
  end_reason       text,
  CHECK (attacker_clan_id <> defender_clan_id)
);
-- At most one active war between any two clans, whoever declared it.
CREATE UNIQUE INDEX wars_active_pair_key
  ON wars (LEAST(attacker_clan_id, defender_clan_id), GREATEST(attacker_clan_id, defender_clan_id))
  WHERE status = 'active';

CREATE TABLE diplomacy (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL CHECK (type IN ('peace')),
  from_clan_id uuid NOT NULL REFERENCES clans(id),
  to_clan_id   uuid NOT NULL REFERENCES clans(id),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  responded_at timestamptz
);
CREATE UNIQUE INDEX diplomacy_pending_key ON diplomacy (from_clan_id, to_clan_id, type) WHERE status = 'pending';

-- ----------------------------------------------------------------- battles

CREATE TABLE battles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  province_id        uuid NOT NULL REFERENCES provinces(id),
  attacker_clan_id   uuid NOT NULL REFERENCES clans(id),
  defender_clan_id   uuid REFERENCES clans(id),
  attacker_army_id   uuid,
  origin_province_id uuid REFERENCES provinces(id),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'cancelled')),
  -- Server-generated seed; with `inputs` it reproduces the report exactly.
  seed               text NOT NULL,
  weather            text,
  inputs             jsonb,
  started_at         timestamptz NOT NULL,
  resolves_at        timestamptz NOT NULL,
  resolved_at        timestamptz
);
CREATE INDEX battles_due_idx ON battles (resolves_at) WHERE status = 'pending';
CREATE INDEX battles_attacker_idx ON battles (attacker_clan_id, started_at DESC);
CREATE INDEX battles_defender_idx ON battles (defender_clan_id, started_at DESC);
CREATE INDEX battles_province_idx ON battles (province_id) WHERE status = 'pending';

-- One report per battle: casualties can only ever be applied once.
CREATE TABLE battle_reports (
  battle_id         uuid PRIMARY KEY REFERENCES battles(id) ON DELETE CASCADE,
  outcome           text NOT NULL,
  winner            text NOT NULL,
  province_captured boolean NOT NULL DEFAULT false,
  attacker_losses   integer NOT NULL,
  defender_losses   integer NOT NULL,
  result            jsonb NOT NULL,
  created_at        timestamptz NOT NULL
);

-- --------------------------------------------------------------- espionage

CREATE TABLE espionage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id            uuid NOT NULL REFERENCES clans(id),
  target_province_id uuid NOT NULL REFERENCES provinces(id),
  target_clan_id     uuid REFERENCES clans(id),
  operation          text NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  detected           boolean NOT NULL DEFAULT false,
  cost               integer NOT NULL,
  success_chance     real NOT NULL,
  detection_chance   real NOT NULL,
  seed               text NOT NULL,
  started_at         timestamptz NOT NULL,
  completes_at       timestamptz NOT NULL,
  resolved_at        timestamptz,
  report             jsonb,
  report_expires_at  timestamptz
);
CREATE INDEX espionage_due_idx ON espionage (completes_at) WHERE status = 'pending';
CREATE INDEX espionage_clan_idx ON espionage (clan_id, started_at DESC);

-- ------------------------------------------------- world history and state

-- The realm chronicle: conquests, wars, famines and other events.
CREATE TABLE world_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL,
  title       text NOT NULL,
  description text NOT NULL,
  province_id uuid REFERENCES provinces(id),
  clan_id     uuid REFERENCES clans(id),
  effects     jsonb,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX world_events_time_idx ON world_events (starts_at DESC);
CREATE INDEX world_events_active_idx ON world_events (ends_at) WHERE ends_at IS NOT NULL;

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX notifications_player_idx ON notifications (player_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (player_id) WHERE read_at IS NULL;

-- One row per processed world tick; the primary key makes double execution impossible.
CREATE TABLE world_ticks (
  tick_number  bigint PRIMARY KEY,
  tick_time    timestamptz NOT NULL,
  status       text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  summary      jsonb
);

-- Singleton row holding the world clock.
CREATE TABLE world_state (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  epoch           timestamptz NOT NULL,
  speed           numeric NOT NULL,
  last_tick       bigint NOT NULL DEFAULT 0,
  last_tick_at    timestamptz,
  hegemon_clan_id uuid REFERENCES clans(id),
  hegemon_since   timestamptz,
  last_error      text,
  last_error_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------- operations and security

CREATE TABLE audit_logs (
  id              bigserial PRIMARY KEY,
  actor_player_id uuid,
  clan_id         uuid,
  action          text NOT NULL,
  entity_type     text,
  entity_id       text,
  data            jsonb,
  created_at      timestamptz NOT NULL
);
CREATE INDEX audit_logs_clan_idx ON audit_logs (clan_id, id DESC);

CREATE TABLE idempotency_keys (
  user_id     uuid NOT NULL,
  key         text NOT NULL,
  route       text NOT NULL,
  status_code integer,
  response    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Realtime outbox: events for the shared "world" room and private "player:<id>" rooms.
CREATE TABLE realtime_events (
  id         bigserial PRIMARY KEY,
  room       text NOT NULL,
  event      text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX realtime_events_room_idx ON realtime_events (room, id);

CREATE TABLE chat_messages (
  id         bigserial PRIMARY KEY,
  channel    text NOT NULL DEFAULT 'world',
  clan_id    uuid REFERENCES clans(id),
  player_id  uuid REFERENCES players(id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX chat_messages_channel_idx ON chat_messages (channel, id DESC);

CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);
