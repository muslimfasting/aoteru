-- Units and buildings are now named for an age of steam and telegraph
-- (Militia, Line Infantry, Riflemen, Guards; Citadel, Academy). New texts use
-- the new names; this rewrites what was already stored in notifications, the
-- chronicle and nation history. Battle records are left exactly as they were.

CREATE FUNCTION pg_temp.rename(t text) RETURNS text AS $$
DECLARE
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['\mlocal warriors\M', 'local militia'],
    ['\mWarriors of\M',    'Militia of'],
    ['\mCastle\M',         'Citadel'],
    ['\mcastle\M',         'citadel'],
    ['\mDojo\M',           'Academy'],
    ['\mdojo\M',           'academy'],
    ['\mAshigaru\M',       'Militia'],
    ['\mashigaru\M',       'militia'],
    ['\mYari\M',           'Line Infantry'],
    ['\myari\M',           'line infantry'],
    ['\mArchers?\M',       'Riflemen'],
    ['\marchers?\M',       'riflemen'],
    ['\mSamurai\M',        'Guards'],
    ['\msamurai\M',        'guards']
  ] LOOP
    t := regexp_replace(t, pair[1], pair[2], 'g');
  END LOOP;
  RETURN t;
END
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE notifications
   SET title = pg_temp.rename(title), body = pg_temp.rename(body)
 WHERE title ~* '\m(castle|dojo|ashigaru|yari|archers?|samurai|warriors)\M'
    OR body  ~* '\m(castle|dojo|ashigaru|yari|archers?|samurai|warriors)\M';

UPDATE world_events
   SET title = pg_temp.rename(title), description = pg_temp.rename(description)
 WHERE title       ~* '\m(castle|dojo|ashigaru|yari|archers?|samurai|warriors)\M'
    OR description ~* '\m(castle|dojo|ashigaru|yari|archers?|samurai|warriors)\M';

UPDATE clan_activity
   SET body = pg_temp.rename(body)
 WHERE body ~* '\m(castle|dojo|ashigaru|yari|archers?|samurai|warriors)\M';
