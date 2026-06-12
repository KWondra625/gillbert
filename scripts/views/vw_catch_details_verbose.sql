CREATE OR REPLACE VIEW vw_catch_details_verbose AS
    SELECT 
        c.id AS id,
        c.catch_number AS catch_number,
        c.status AS status,
        c.record_source AS record_source,
        
        a.id AS angler_id,
        a.name AS angler_name,
        
        fs.id AS fish_species_id,
        fs.name AS fish_species_name,
        
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
        a.name || '''s '
        || CASE WHEN c.length_in_inches > 0 THEN c.length_in_inches::TEXT || 'in ' ELSE '' END
        || fs.name
        || CASE WHEN bow.name IS NOT NULL THEN ' caught on ' || bow.name ELSE '' END
        || CASE WHEN c.water_depth_in_feet IS NOT NULL THEN ' in ' || c.water_depth_in_feet::TEXT || ''' of water' ELSE '' END
        || '.' AS headline,

        -- Full Summary (with date/time)
        a.name || '''s '
        || CASE WHEN c.length_in_inches > 0 THEN c.length_in_inches::TEXT || 'in ' ELSE '' END
        || fs.name
        || CASE WHEN bow.name IS NOT NULL THEN ' caught on ' || bow.name ELSE '' END
        || CASE WHEN c.water_depth_in_feet IS NOT NULL THEN ' in ' || c.water_depth_in_feet::TEXT || ''' of water' ELSE '' END
        || CASE WHEN c.caught_when IS NOT NULL THEN ' on ' || TO_CHAR(c.caught_when AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') || ' at ' || TO_CHAR(c.caught_when AT TIME ZONE 'America/Chicago', 'HH24:MI') ELSE '' END
        || '.' AS full_summary,

        c.created_at AS created_at,
        c.updated_at AS updated_at,

        (SELECT COUNT(*) FROM catch_media cm WHERE cm.catch_id = c.id) AS catch_media_count

    FROM catches c 
        INNER JOIN anglers a ON c.angler_id = a.id
        INNER JOIN fish_species fs ON c.fish_species_id = fs.id
        INNER JOIN bodies_of_water bow ON c.body_of_water_id = bow.id
    WHERE c.status = 'Active'
    ORDER BY c.caught_when DESC;
