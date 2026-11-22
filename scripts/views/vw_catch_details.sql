-- Drop + create (not REPLACE): servers have drifted in column order, which REPLACE can't change.
-- Nothing depends on this view. One transaction, so readers never see it missing.
-- Dropping a view also drops its grants: this script notes who can read the view (and the
-- media view, in case this view is brand new) before the drop, and grants them read access
-- again at the end. Without that, every page that lists catches fails with "permission
-- denied" (production, 2026-11-04 release, ~4 minutes).
BEGIN;

-- Who reads these views today (the app's database user, and any other reader role)
CREATE TEMP TABLE keep_view_readers ON COMMIT DROP AS
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
    WHERE table_schema = current_schema()
      AND table_name IN ('vw_catch_details', 'vw_catch_media_details')
      AND privilege_type = 'SELECT'
      AND grantee NOT IN ('postgres', 'PUBLIC', current_user);

DROP VIEW IF EXISTS vw_catch_details;
CREATE VIEW vw_catch_details AS
    SELECT 
        c.id AS id,
        c.catch_number AS catch_number,
        c.status AS status,
        c.record_source AS record_source,
        
        a.id AS angler_id,
        a.display_name AS angler_name,
        
        fs.id AS fish_species_id,
        COALESCE(fs.display_name_override, fs.name) AS fish_species_name,

        bow.id AS body_of_water_id,
        bow.name AS body_of_water_name,

        c.caught_when AS caught_when,
        (c.caught_when AT TIME ZONE 'America/Chicago')::TIME AS caught_time,
        EXTRACT(DAY FROM c.caught_when AT TIME ZONE 'America/Chicago') AS caught_day,
        EXTRACT(MONTH FROM c.caught_when AT TIME ZONE 'America/Chicago') AS caught_month,
        EXTRACT(YEAR FROM c.caught_when AT TIME ZONE 'America/Chicago') AS caught_year,
        c.length_in_inches AS length_in_inches,
        c.water_depth_in_feet AS water_depth_in_feet,
        c.notes AS notes,

        -- Headline (without date/time)
        a.display_name || '''s '
        || CASE WHEN c.length_in_inches > 0 THEN c.length_in_inches::TEXT || 'in ' ELSE '' END
        || COALESCE(fs.display_name_override, fs.name)
        || CASE WHEN bow.name IS NOT NULL THEN ' caught on ' || bow.name ELSE '' END
        || CASE WHEN c.water_depth_in_feet IS NOT NULL THEN ' in ' || c.water_depth_in_feet::TEXT || ''' of water' ELSE '' END
        || '.' AS headline,

        -- Full Summary (with date/time)
        a.display_name || '''s '
        || CASE WHEN c.length_in_inches > 0 THEN c.length_in_inches::TEXT || 'in ' ELSE '' END
        || COALESCE(fs.display_name_override, fs.name)
        || CASE WHEN bow.name IS NOT NULL THEN ' caught on ' || bow.name ELSE '' END
        || CASE WHEN c.water_depth_in_feet IS NOT NULL THEN ' in ' || c.water_depth_in_feet::TEXT || ''' of water' ELSE '' END
        || CASE WHEN c.caught_when IS NOT NULL THEN ' on ' || TO_CHAR(c.caught_when AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') || ' at ' || TO_CHAR(c.caught_when AT TIME ZONE 'America/Chicago', 'HH24:MI') ELSE '' END
        || '.' AS full_summary,

        -- Catch Verification
        c.verified_at AS verified_at,
        CASE
            WHEN c.verified_at IS NULL THEN null
            WHEN c.verified_at < c.updated_at THEN true
            ELSE false
        END AS isUpdatedAfterVerification,

        c.created_by_angler_id AS created_by_angler_id,
        a2.display_name as created_by_angler_name,
        c.created_at AS created_at,
        c.updated_by_angler_id AS updated_by_angler_id,
        a3.display_name as updated_by_angler_name,
        c.updated_at AS updated_at,

        -- Viewable media only; files still converting are counted separately below.
        (SELECT COUNT(*) FROM catch_media cm WHERE cm.catch_id = c.id AND cm.status = 'complete') AS catch_media_count,

        -- Appended after the view's other columns (not grouped with their
        -- related fields above): CREATE OR REPLACE VIEW can only add columns
        -- at the end, not insert them mid-list, or Postgres errors on the
        -- shifted existing columns. Consumers read these by name, not
        -- position, so the non-adjacent placement is harmless.
        fs.dnr_url AS fish_species_dnr_url,
        bow.wbic AS body_of_water_wbic,
        bow.dnr_url_verified AS body_of_water_dnr_url_verified,

        -- Files still converting (drives the ⏳ badge). Excludes stuck ones (no status
        -- change in 30 minutes), matching vw_catch_media_details.display_status.
        (SELECT COUNT(*) FROM catch_media cm
            WHERE cm.catch_id = c.id
              AND cm.status IN ('submitted', 'processing')
              AND cm.status_updated_at >= CURRENT_TIMESTAMP - INTERVAL '30 minutes') AS catch_media_processing_count

    FROM catches c
        INNER JOIN anglers a ON c.angler_id = a.id
        LEFT JOIN anglers a2 ON c.created_by_angler_id = a2.id
        LEFT JOIN anglers a3 ON c.updated_by_angler_id = a3.id
        INNER JOIN fish_species fs ON c.fish_species_id = fs.id
        INNER JOIN bodies_of_water bow ON c.body_of_water_id = bow.id
    WHERE c.status = 'Active'
    ORDER BY c.caught_when DESC;

-- Give every reader noted above its read access back
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT grantee FROM keep_view_readers LOOP
    EXECUTE format('GRANT SELECT ON vw_catch_details TO %I', r.grantee);
    RAISE NOTICE 'vw_catch_details: SELECT granted to %', r.grantee;
  END LOOP;
  IF NOT FOUND THEN
    RAISE WARNING 'vw_catch_details: no reader roles found, nobody but the owner can read the view: check grants before the site uses it';
  END IF;
END $$;

COMMIT;
