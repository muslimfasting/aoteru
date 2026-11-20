-- The Art of War (change request v2.0, §6-§10): battlefield strategies, the
-- War Council, treaties between clans, doctrines and the clan war record.

-- ------------------------------------------------------------ strategy

-- The tactic an army marches with, and the war plan it belongs to (if any).
ALTER TABLE armies
  ADD COLUMN tactic  text NOT NULL DEFAULT 'assault',
  ADD COLUMN plan_id uuid;

-- The stance a province is held in. A newly ordered stance takes time to
-- prepare: `stance` stays in force until `stance_ready_at`, then `stance_next` is.
ALTER TABLE provinces
  ADD COLUMN stance          text NOT NULL DEFAULT 'formation',
  ADD COLUMN stance_next     text,
  ADD COLUMN stance_ready_at timestamptz;

ALTER TABLE battles
  ADD COLUMN tactic              text NOT NULL DEFAULT 'assault',
  ADD COLUMN commander_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN plan_id             uuid;

-- --------------------------------------------------------- war council

CREATE TABLE war_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id             uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  title               text NOT NULL,
  target_province_id  uuid NOT NULL REFERENCES provinces(id),
  origin_province_id  uuid NOT NULL REFERENCES provinces(id),
  tactic              text NOT NULL DEFAULT 'assault',
  units               jsonb NOT NULL DEFAULT '{}',
  commander_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  -- When the clan means to strike. For coordination; the launch itself is an order.
  scheduled_at        timestamptz,
  -- Retreat condition, backup strategy, anything the council should know.
  notes               text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'launched', 'completed', 'cancelled')),
  created_by          uuid REFERENCES players(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  launched_at         timestamptz,
  army_id             uuid,
  battle_id           uuid,
  outcome             text
);
CREATE INDEX war_plans_clan_idx ON war_plans (clan_id, created_at DESC);

CREATE TABLE war_assignments (
  plan_id      uuid NOT NULL REFERENCES war_plans(id) ON DELETE CASCADE,
  player_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  duty         text NOT NULL
    CHECK (duty IN ('commander', 'scout', 'defender', 'logistics', 'spy', 'reinforcement', 'strategist')),
  status       text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'accepted', 'declined')),
  note         text NOT NULL DEFAULT '',
  assigned_by  uuid REFERENCES players(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL,
  responded_at timestamptz,
  PRIMARY KEY (plan_id, player_id, duty)
);
CREATE INDEX war_assignments_player_idx ON war_assignments (player_id);

-- ------------------------------------------------------------ treaties

ALTER TABLE diplomacy DROP CONSTRAINT diplomacy_type_check;
ALTER TABLE diplomacy ADD CONSTRAINT diplomacy_type_check CHECK (type IN ('peace', 'nap', 'alliance'));

-- Standing agreements between two clans: a non-aggression pact or an alliance.
CREATE TABLE pacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL CHECK (type IN ('nap', 'alliance')),
  clan_a     uuid NOT NULL REFERENCES clans(id),
  clan_b     uuid NOT NULL REFERENCES clans(id),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at timestamptz NOT NULL,
  -- Null: lasts until one side ends it.
  ends_at    timestamptz,
  ended_at   timestamptz,
  end_reason text,
  broken_by  uuid REFERENCES clans(id),
  CHECK (clan_a <> clan_b)
);
-- At most one standing agreement between any two clans.
CREATE UNIQUE INDEX pacts_active_pair_key ON pacts (LEAST(clan_a, clan_b), GREATEST(clan_a, clan_b)) WHERE status = 'active';
CREATE INDEX pacts_clan_a_idx ON pacts (clan_a) WHERE status = 'active';
CREATE INDEX pacts_clan_b_idx ON pacts (clan_b) WHERE status = 'active';

-- ---------------------------------------------------------- war record

ALTER TABLE clans
  ADD COLUMN victories integer NOT NULL DEFAULT 0,
  ADD COLUMN defeats   integer NOT NULL DEFAULT 0;

UPDATE clans c SET
  victories = (SELECT COUNT(*) FROM battles b JOIN battle_reports r ON r.battle_id = b.id
                WHERE (b.attacker_clan_id = c.id AND r.winner = 'attacker') OR (b.defender_clan_id = c.id AND r.winner = 'defender')),
  defeats   = (SELECT COUNT(*) FROM battles b JOIN battle_reports r ON r.battle_id = b.id
                WHERE (b.attacker_clan_id = c.id AND r.winner = 'defender') OR (b.defender_clan_id = c.id AND r.winner = 'attacker'));

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;
