-- gillbert_ai_reader: a login that can only read vw_catch_details.
-- Used by Ask Gillbert's AI database tools (Recent Catches, Count Catches, Biggest Catches,
-- Catches by Date Range, Species Breakdown, Angler Leaderboard, Body of Water Breakdown),
-- through their own n8n credential. Everything else uses gillbert_fullaccess.
--
-- Run as the database admin, in the Gillbert database (run the whole file). Safe to re-run.
-- Renames the earlier gillbert_readonly if it exists (its password and grants carry over).
-- No password here: for a new role, set one afterwards, by hand, and use it only in n8n:
--   ALTER ROLE gillbert_ai_reader PASSWORD '...';
-- The view runs with its owner's rights, so reading the view needs no rights on its tables.
-- scripts/views/vw_catch_details.sql keeps this grant when it rebuilds the view.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_readonly')
     AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_ai_reader') THEN
    ALTER ROLE gillbert_readonly RENAME TO gillbert_ai_reader;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_ai_reader') THEN
    CREATE ROLE gillbert_ai_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO gillbert_ai_reader', current_database());
END $$;

-- Belt and braces: every session is read-only, and a runaway query stops after 15 seconds
ALTER ROLE gillbert_ai_reader SET default_transaction_read_only = on;
ALTER ROLE gillbert_ai_reader SET statement_timeout = '15s';

GRANT USAGE ON SCHEMA public TO gillbert_ai_reader;
GRANT SELECT ON vw_catch_details TO gillbert_ai_reader;

-- Check: only the first column should be true
SELECT has_table_privilege('gillbert_ai_reader', 'vw_catch_details', 'SELECT') AS reads_view,
       has_table_privilege('gillbert_ai_reader', 'catches', 'SELECT')          AS reads_catches,
       has_table_privilege('gillbert_ai_reader', 'catches', 'INSERT,UPDATE,DELETE') AS writes_catches,
       has_table_privilege('gillbert_ai_reader', 'anglers', 'SELECT')          AS reads_anglers,
       (SELECT rolsuper FROM pg_roles WHERE rolname = 'gillbert_ai_reader')     AS superuser;
