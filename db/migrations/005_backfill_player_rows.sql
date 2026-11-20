-- Players who registered while the previous release was still running against
-- the new schema have no purse and no pillar rows of their own. Give them both.
-- Safe to run on any database: it only fills what is missing.

INSERT INTO player_resources (player_id, gold, food, wood, stone, iron)
  SELECT p.id, 300, 200, 150, 100, 50
    FROM players p
   WHERE NOT EXISTS (SELECT 1 FROM player_resources r WHERE r.player_id = p.id);

INSERT INTO player_pillars (player_id, pillar)
  SELECT p.id, x.pillar
    FROM players p
    CROSS JOIN (VALUES ('military'), ('leadership'), ('economy'), ('intelligence'), ('culture')) AS x(pillar)
  ON CONFLICT DO NOTHING;

-- A leader recorded on the clan but missing from its member list (the same window).
INSERT INTO clan_members (player_id, clan_id, role, joined_at)
  SELECT c.player_id, c.id, 'leader', c.created_at
    FROM clans c
   WHERE c.player_id IS NOT NULL AND c.status <> 'disbanded'
     AND NOT EXISTS (SELECT 1 FROM clan_members m WHERE m.player_id = c.player_id)
     AND NOT EXISTS (SELECT 1 FROM clan_members m WHERE m.clan_id = c.id AND m.role = 'leader');

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
   WHERE NOT c.is_npc
     AND NOT EXISTS (SELECT 1 FROM clan_role_permissions p WHERE p.clan_id = c.id)
  ON CONFLICT DO NOTHING;
