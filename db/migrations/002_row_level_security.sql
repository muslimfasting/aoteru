-- Close every table to roles other than the game server's own.
--
-- Hosted PostgreSQL platforms such as Supabase put an HTTP data API in front of
-- the "public" schema and let low-privilege roles (anon, authenticated) reach
-- any table that does not have row level security enabled. The game server
-- connects as the table owner, which row level security does not restrict, so
-- enabling it with no policies leaves the game untouched and denies everyone
-- else. On plain PostgreSQL this changes nothing.
--
-- Any later migration that creates a table must enable row level security on it too.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;
