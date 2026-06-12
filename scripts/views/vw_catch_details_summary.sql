CREATE OR REPLACE VIEW vw_catch_details_summary AS
    SELECT 
        vcdv.id AS id,
        vcdv.catch_number AS catch_number,
        vcdv.status AS status,
        vcdv.record_source AS record_source,

        vcdv.angler_name AS angler_name,
        vcdv.fish_species_name AS fish_species_name,
        vcdv.body_of_water_name AS body_of_water_name,
        
        vcdv.caught_when AS caught_when,
        vcdv.caught_time AS caught_time,
        vcdv.caught_day AS caught_day,

        vcdv.length_in_inches AS length_in_inches,
        vcdv.water_depth_in_feet AS water_depth_in_feet,
        vcdv.notes AS notes,

        vcdv.headline AS headline,
        vcdv.full_summary AS full_summary,

        vcdv.created_at AS created_at,
        vcdv.updated_at AS updated_at,
        
        vcdv.catch_media_count AS catch_media_count

    FROM vw_catch_details_verbose vcdv
