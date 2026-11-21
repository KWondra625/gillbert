-- gillbert_fullaccess: the main login for every Gillbert n8n workflow (except Ask Gillbert's
-- AI tools, which use gillbert_ai_reader). Full rights within the Gillbert database, by owning
-- it and everything in it; not a superuser, and no rights in the server's other databases.
-- The admin login (the server's superuser) stays for DBeaver, schema scripts and backups.
--
-- Run as the database admin, in the Gillbert database (run the whole file). Safe to re-run:
-- it only moves ownership of what the admin owns. No password here: set one afterwards, by
-- hand, and use it only in the n8n credential:
--   ALTER ROLE gillbert_fullaccess PASSWORD '...';
--
-- Objects created later by the admin (e.g. a new table from DBeaver) stay the admin's, so the
-- default privileges below give this login full rights on them. View scripts keep its grant.

DO $$
DECLARE
  admin_role text := current_user;
  r record;
BEGIN
  IF (SELECT NOT rolsuper FROM pg_roles WHERE rolname = admin_role) THEN
    RAISE EXCEPTION 'Run this as the database admin (a superuser), not %', admin_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_fullaccess') THEN
    CREATE ROLE gillbert_fullaccess LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;

  -- The database itself (its owner also owns the public schema, and may create schemas:
  -- the weekly snapshot job creates one each week and drops old ones)
  EXECUTE format('ALTER DATABASE %I OWNER TO gillbert_fullaccess', current_database());

  -- Every other schema the admin owns (airtable_backup, weekly snapshots)
  FOR r IN SELECT nspname FROM pg_namespace
           WHERE pg_get_userbyid(nspowner) = admin_role
             AND nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema' LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO gillbert_fullaccess', r.nspname);
  END LOOP;

  -- Tables, views and stand-alone sequences in those schemas (a table's own id sequence
  -- follows its table). Extension objects (pg_trgm) are left alone.
  FOR r IN SELECT n.nspname, c.relname, c.relkind FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE pg_get_userbyid(c.relowner) = admin_role
             AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
             AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                             AND d.objid = c.oid AND d.deptype IN ('a', 'i', 'e')) LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO gillbert_fullaccess',
                   CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                                  WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
                   r.nspname, r.relname);
  END LOOP;

  -- Our own functions (e.g. generate_catch_number), not the extension's
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE pg_get_userbyid(p.proowner) = admin_role AND n.nspname = 'public'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                             AND d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO gillbert_fullaccess', r.sig);
  END LOOP;

  -- Whatever the admin creates here later
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON TABLES TO gillbert_fullaccess', admin_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON SEQUENCES TO gillbert_fullaccess', admin_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON FUNCTIONS TO gillbert_fullaccess', admin_role);
END $$;

-- Check: superuser false, 0 Gillbert objects left with the admin, writes true, other databases' data unreadable
SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = 'gillbert_fullaccess') AS superuser,
       (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS database_owner,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r', 'v', 'S') AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
           AND pg_get_userbyid(c.relowner) <> 'gillbert_fullaccess') AS objects_not_owned,
       has_table_privilege('gillbert_fullaccess', 'catches', 'SELECT,INSERT,UPDATE,DELETE') AS writes_catches,
       has_sequence_privilege('gillbert_fullaccess', 'catches_id_seq', 'USAGE') AS uses_sequences;
