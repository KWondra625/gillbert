-- gillbert_readonly: a login that can only read vw_catch_details.
-- Used by Ask Gillbert's AI database tools (Recent Catches, Count Catches, Biggest Catches,
-- Catches by Date Range, Species Breakdown, Angler Leaderboard, Body of Water Breakdown),
-- through their own n8n credential. Everything else in Ask Gillbert keeps the main login.
--
-- Run as the database owner, in the Gillbert database. Safe to re-run.
-- No password here: set one afterwards, by hand, and use it only in the n8n credential:
--   ALTER ROLE gillbert_readonly PASSWORD '...';
-- The view runs with its owner's rights, so reading the view needs no rights on its tables.
-- scripts/views/vw_catch_details.sql keeps this grant when it rebuilds the view.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_readonly') THEN
    CREATE ROLE gillbert_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO gillbert_readonly', current_database());
END $$;

-- Belt and braces: every session is read-only, and a runaway query stops after 15 seconds
ALTER ROLE gillbert_readonly SET default_transaction_read_only = on;
ALTER ROLE gillbert_readonly SET statement_timeout = '15s';

GRANT USAGE ON SCHEMA public TO gillbert_readonly;
GRANT SELECT ON vw_catch_details TO gillbert_readonly;

-- Check: only the first column should be true
SELECT has_table_privilege('gillbert_readonly', 'vw_catch_details', 'SELECT') AS reads_view,
       has_table_privilege('gillbert_readonly', 'catches', 'SELECT')          AS reads_catches,
       has_table_privilege('gillbert_readonly', 'catches', 'INSERT,UPDATE,DELETE') AS writes_catches,
       has_table_privilege('gillbert_readonly', 'anglers', 'SELECT')          AS reads_anglers,
       (SELECT rolsuper FROM pg_roles WHERE rolname = 'gillbert_readonly')     AS superuser;
