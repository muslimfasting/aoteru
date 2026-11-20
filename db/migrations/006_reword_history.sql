-- The factions of the game are now nations with governments, not clans of
-- daimyo. New texts say so; this rewrites what was already stored — chronicle
-- entries, notifications and nation history — so the past reads the same way.

CREATE FUNCTION pg_temp.reword(t text) RETURNS text AS $$
  SELECT
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(t,
      '\mThe house of\M', 'The government of', 'g'),
      '\mYour Daimyo keeps\M', 'Everyone keeps', 'g'),
      '\mNPC daimyo\M', 'rival governments', 'g'),
      '\mClans\M', 'Nations', 'g'),
      '\mClan\M', 'Nation', 'g'),
      '\mclans\M', 'nations', 'g'),
      '\mclan\M', 'nation', 'g'),
      '\m(Daimyo|Shogun)\M', 'Chancellor', 'g'),
      '\mdaimyo\M', 'chancellor', 'g')
$$ LANGUAGE sql IMMUTABLE;

UPDATE world_events
   SET title = pg_temp.reword(title), description = pg_temp.reword(description)
 WHERE title ~* '\m(clans?|daimyo|shogun)\M' OR description ~* '\m(clans?|daimyo|shogun)\M'
    OR title ~ '\mThe house of\M';

UPDATE notifications
   SET title = pg_temp.reword(title), body = pg_temp.reword(body)
 WHERE title ~* '\m(clans?|daimyo|shogun)\M' OR body ~* '\m(clans?|daimyo|shogun)\M';

UPDATE clan_activity
   SET body = pg_temp.reword(body)
 WHERE body ~* '\m(clans?|daimyo|shogun)\M';
