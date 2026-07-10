-- Diagnostic only — reads current column datatypes, makes no changes.
-- Run before 2026-07-10-convert_timestamp_columns_to_timestamptz.sql to check
-- whether the live database already matches TIMESTAMPTZ and the tracked
-- scripts/tables/*.sql files were just out of sync, vs. the columns genuinely
-- still being TIMESTAMP and needing the migration.
--
-- data_type will read exactly 'timestamp without time zone' or
-- 'timestamp with time zone' — udt_name gives the shorthand ('timestamp' /
-- 'timestamptz') for a quicker glance.

SELECT
  table_name,
  column_name,
  data_type,
  udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'anglers'          AND column_name IN ('created_at', 'updated_at'))
    OR (table_name = 'bodies_of_water' AND column_name IN ('created_at', 'updated_at'))
    OR (table_name = 'fish_species'    AND column_name IN ('created_at', 'updated_at'))
    OR (table_name = 'catch_media'     AND column_name IN ('uploaded_at', 'created_at', 'updated_at'))
    OR (table_name = 'conversations'   AND column_name IN ('caught_when_utc', 'started_at', 'ended_at', 'created_at', 'updated_at'))
    OR (table_name = 'catches'         AND column_name IN ('caught_when', 'verified_at', 'created_at', 'updated_at'))
  )
ORDER BY table_name, column_name;
