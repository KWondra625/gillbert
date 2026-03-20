CREATE TABLE IF NOT EXISTS anglers (
    id SERIAL PRIMARY KEY,
    name varchar(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Active', 'Inactive')),
    aliases varchar(255)[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bodies_of_water (
    id SERIAL PRIMARY KEY,
    name varchar(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Active', 'Inactive')),
    latitude double precision,
    longitude double precision,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fish_species (
    id SERIAL PRIMARY KEY,
    name varchar(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Active', 'Inactive')),
    aliases varchar(255)[],
    notes TEXT, 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    n8n_conversation_id varchar(255) NOT NULL,
    channel varchar(255) NOT NULL,
    session_id varchar(255) NOT NULL,
    mode varchar(255),
    caught_when_utc TIMESTAMPTZ,
    timezone varchar(255),
    date_of_catch_raw varchar(255),
    time_of_catch_raw varchar(255),
    caught_by_raw varchar(255),
    fish_species_raw varchar(255),
    body_of_water_raw varchar(255),
    length_in_raw varchar(255),
    water_depth_ft_raw varchar(255),
    notes_raw TEXT,
    conversation_status varchar(255),
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS catches (
    id SERIAL PRIMARY KEY,
    catch_number varchar(50),
    status VARCHAR(50) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    record_source varchar(255) NOT NULL,
    angler_id INT NOT NULL REFERENCES anglers(id),
    fish_species_id INT NOT NULL REFERENCES fish_species(id),
    body_of_water_id INT NOT NULL REFERENCES bodies_of_water(id),
    caught_when TIMESTAMPTZ,
    length_in_inches FLOAT,
    water_depth_in_feet FLOAT,
    notes TEXT,
    conversation_id INT REFERENCES conversations(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS catch_media (
    id SERIAL PRIMARY KEY,
    catch_id INT NOT NULL REFERENCES catches(id),
    blob_path varchar(255) NOT NULL,
    read_url varchar(255) NOT NULL,
    original_filename varchar(255) NOT NULL,
    media_type VARCHAR(50) NOT NULL CHECK (media_type IN ('Photo', 'Video')),
    content_type varchar(255) NOT NULL,
    file_size_bytes INT NOT NULL,
    uploaded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


    CREATE OR REPLACE VIEW vw_angler_details AS
    SELECT a.id AS id,
            a.name AS name,
            a.status AS status,
            a.aliases AS aliases,
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
    GROUP BY a.id, a.name, a.status, a.aliases, 
             last_catch.caught_when, last_catch.catch_id, last_catch.catch_number,
             biggest_catch.catch_id, biggest_catch.catch_number
    ORDER BY a.id;


CREATE OR REPLACE VIEW vw_catch_details AS
    SELECT 
        c.id AS id,
        c.catch_number AS catch_number,
        c.status AS status,
        c.record_source AS record_source,
        a.name AS angler_name,
        fs.name AS fish_species_name,
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
        c.updated_at AS updated_at

    FROM catches c 
        INNER JOIN anglers a ON c.angler_id = a.id
        INNER JOIN fish_species fs ON c.fish_species_id = fs.id
        INNER JOIN bodies_of_water bow ON c.body_of_water_id = bow.id
    WHERE c.status = 'Active'
    ORDER BY c.caught_when DESC;

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
           cm.created_at AS created_at,
           cm.updated_at AS updated_at
    FROM catch_media cm INNER JOIN catches c ON cm.catch_id = c.id
    ORDER BY cm.id  


    --Run this script to ensure all id value sequences are re-aligned.  Harmless to run if this is already working.
    SELECT setval('anglers_id_seq', (SELECT MAX(id) FROM anglers));
    SELECT setval('bodies_of_water_id_seq', (SELECT MAX(id) FROM bodies_of_water));
    SELECT setval('catches_id_seq', (SELECT MAX(id) FROM catches));
    SELECT setval('catch_media_id_seq', (SELECT MAX(id) FROM catch_media));
    SELECT setval('conversations_id_seq', (SELECT MAX(id) FROM conversations));
    SELECT setval('fish_species_id_seq', (SELECT MAX(id) FROM fish_species));