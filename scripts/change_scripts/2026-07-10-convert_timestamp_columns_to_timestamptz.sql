-- Standardizes all remaining TIMESTAMP (no tz) audit/date columns to TIMESTAMPTZ,
-- matching what the `catches` table already does. Assumes existing naive values
-- were written in UTC (the n8n Postgres connection's session timezone) —
-- verified 2026-07-10 by comparing catch_media.uploaded_at (n8n-computed,
-- explicit UTC) against catch_media.created_at (Postgres CURRENT_TIMESTAMP)
-- for the same insert, across two executions ~2 weeks apart: both matched to
-- within single-digit milliseconds, confirming the session timezone has
-- consistently been UTC. Confirmed against live column types via
-- scripts/check_timestamp_column_types.sql before running.
--
-- Wrapped in a transaction so a failure partway through leaves nothing
-- changed rather than a mix of converted/unconverted tables.
--
-- Two views select these columns directly and must be dropped before the
-- ALTER and recreated after — Postgres won't let you change the type of a
-- column a view depends on. Confirmed via error 0A000 on the first attempt
-- (blocked by vw_angler_details on anglers.created_at/updated_at); a second
-- dependency on catch_media.uploaded_at/created_at/updated_at via
-- vw_catch_media_details was found by inspecting scripts/views/*.sql before
-- re-running. No other view depends on the columns touched here.
--
-- vw_catch_media_details is also recreated with its new uploaded_by_angler_id
-- / uploaded_by_angler_name columns (LEFT JOIN anglers, not INNER — the FK is
-- nullable for historical rows, same reasoning as vw_catch_details's existing
-- created_by/updated_by joins).

BEGIN;

DROP VIEW vw_angler_details;
DROP VIEW vw_catch_media_details;

ALTER TABLE anglers ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE anglers ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE bodies_of_water ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE bodies_of_water ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE fish_species ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE fish_species ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE catch_media ALTER COLUMN uploaded_at TYPE TIMESTAMPTZ USING uploaded_at AT TIME ZONE 'UTC';
ALTER TABLE catch_media ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE catch_media ALTER COLUMN updated_at  TYPE TIMESTAMPTZ USING updated_at  AT TIME ZONE 'UTC';

ALTER TABLE conversations ALTER COLUMN started_at TYPE TIMESTAMPTZ USING started_at AT TIME ZONE 'UTC';
ALTER TABLE conversations ALTER COLUMN ended_at   TYPE TIMESTAMPTZ USING ended_at   AT TIME ZONE 'UTC';
ALTER TABLE conversations ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE conversations ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

CREATE OR REPLACE VIEW vw_angler_details AS
    SELECT a.id AS id,
            a.name AS name,
            a.status AS status,
            a.aliases AS aliases,
            a.login_emails AS login_emails,
            COUNT(c.id) AS catch_count,
            biggest_catch.catch_id AS biggest_catch_id,
            biggest_catch.catch_number AS biggest_catch_number,
            MAX(c.length_in_inches) AS biggest_catch_in_inches,
            CAST(AVG(c.length_in_inches) AS decimal(10,2)) AS average_catch_in_inches,
            last_catch.catch_id AS last_catch_id,
            last_catch.catch_number AS last_catch_number,
            last_catch.caught_when AT TIME ZONE 'America/Chicago' AS last_catch_date,
            a.created_at AS created_at,
            a.updated_at AS updated_at
    FROM anglers a
    INNER JOIN catches c ON a.id = c.angler_id
    CROSS JOIN LATERAL (
        SELECT c2.id AS catch_id, c2.catch_number AS catch_number, c2.caught_when AS caught_when
        FROM catches c2
        WHERE c2.angler_id = a.id
        ORDER BY c2.caught_when DESC
        LIMIT 1
    ) last_catch
    CROSS JOIN LATERAL (
        SELECT c3.id AS catch_id, c3.catch_number AS catch_number
        FROM catches c3
        WHERE c3.angler_id = a.id
        ORDER BY c3.length_in_inches DESC
        LIMIT 1
    ) biggest_catch
    GROUP BY a.id, a.name, a.status, a.aliases, a.login_emails,
             last_catch.caught_when, last_catch.catch_id, last_catch.catch_number,
             biggest_catch.catch_id, biggest_catch.catch_number
    ORDER BY a.id;

CREATE OR REPLACE VIEW vw_catch_media_details AS
    SELECT cm.id AS id,
           c.catch_number AS catch_number,
           cm.blob_path AS blob_path,
           cm.read_url AS read_url,
           cm.original_filename AS original_filename,
           cm.media_type AS media_type,
           cm.content_type AS content_type,
           cm.file_size_bytes AS file_size_bytes,
           cm.uploaded_at AS uploaded_at,
           cm.uploaded_by_angler_id AS uploaded_by_angler_id,
           a.name as uploaded_by_angler_name,
           cm.created_at AS created_at,
           cm.updated_at AS updated_at
    FROM catch_media cm INNER JOIN catches c ON cm.catch_id = c.id
           LEFT JOIN anglers a ON cm.uploaded_by_angler_id = a.id
    ORDER BY cm.id;

COMMIT;
