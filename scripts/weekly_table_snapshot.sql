-- Weekly point-in-time snapshot of every table in the public schema, into a
-- dated schema named "YYYYMMDD" (e.g. "20260806"). Data-only — no
-- constraints, indexes, defaults, or triggers carried over — this is a quick
-- look-back tool ("what did this look like a few weeks ago"), not a restore
-- mechanism or disaster-recovery backup; the pg_dump-to-Azure-Blob job
-- already covers that.
--
-- Safe to re-run same-day (drops and recreates that day's schema first).
-- Automatically excludes views (only real tables are copied).
--
-- Retention: keeps the most recent 8 dated snapshot schemas, dropping older
-- ones. Adjust retention_count below to change that.
--
-- Run via the "Gillbert - Weekly Postgres Snapshot" n8n workflow (Schedule
-- Trigger, Sundays 4am) — see that workflow for the automated schedule, or
-- run this directly for an on-demand snapshot.

DO $$
DECLARE
    snapshot_schema text := to_char(now(), 'YYYYMMDD');
    tbl record;
    old_schema record;
    retention_count int := 8;
BEGIN
    -- Start clean in case this is ever re-run on the same day
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', snapshot_schema);
    EXECUTE format('CREATE SCHEMA %I', snapshot_schema);

    -- Copy every real table (not views) in public into this week's schema
    FOR tbl IN
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format(
            'CREATE TABLE %I.%I AS TABLE public.%I',
            snapshot_schema, tbl.table_name, tbl.table_name
        );
    END LOOP;

    -- Retention: keep only the most recent N dated snapshot schemas
    FOR old_schema IN
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name ~ '^\d{8}$'
        ORDER BY schema_name DESC
        OFFSET retention_count
    LOOP
        EXECUTE format('DROP SCHEMA %I CASCADE', old_schema.schema_name);
    END LOOP;
END $$;
