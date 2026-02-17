DROP SCHEMA IF EXISTS airtable_backup CASCADE;

CREATE SCHEMA IF NOT EXISTS airtable_backup;

CREATE TABLE IF NOT EXISTS airtable_backup.anglers (
    id SERIAL PRIMARY KEY,
    name varchar(255) NOT NULL,
    status varchar(255) NOT NULL, 
    aliases varchar(255)[],
    airtable_record_id varchar(255) NOT NULL,
    airtable_created_datetime TIMESTAMP,
    airtable_last_updated_datetime TIMESTAMP, 
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS airtable_backup.bodies_of_water (
    id SERIAL PRIMARY KEY,
    name varchar(255) NOT NULL,
    status varchar(255) NOT NULL,
    latitudeAndLongitude varchar(255) NOT NULL,
    notes TEXT,
    airtable_record_id varchar(255) NOT NULL,
    airtable_created_datetime TIMESTAMP,
    airtable_last_updated_datetime TIMESTAMP, 
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS airtable_backup.fish_species (
     id SERIAL PRIMARY KEY,
    name varchar(255) NOT NULL,
    status varchar(255) NOT NULL, 
    aliases varchar(255)[],
    notes TEXT,
    airtable_record_id varchar(255) NOT NULL,
    airtable_created_datetime TIMESTAMP,
    airtable_last_updated_datetime TIMESTAMP, 
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS airtable_backup.conversations (
    id SERIAL PRIMARY KEY,
    conversation_id varchar(255) NOT NULL,
    channel varchar(255) NOT NULL,
    user_id varchar(255) NOT NULL,
    session_id varchar(255) NOT NULL,
    mode varchar(255), 
    at_catch_table_id varchar(255),
    caught_when_utc TIMESTAMP,
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
    airtable_record_id varchar(255) NOT NULL,
    airtable_created_datetime TIMESTAMP,
    airtable_last_updated_datetime TIMESTAMP, 
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS airtable_backup.catches (
    id SERIAL PRIMARY KEY,
    catch_id varchar(255) NOT NULL,
    status varchar(255) NOT NULL,
    record_source varchar(255) NOT NULL,
    angler_id varchar(255),
    angler_name varchar(255),
    fish_species_id varchar(255),
    fish_species_name varchar(255),
    body_of_water_id varchar(255),
    body_of_water_name varchar(255),
    caught_when TIMESTAMP,
    length_in_inches FLOAT, 
    water_depth_in_feet FLOAT,
    notes TEXT,
    conversation_airtable_id varchar(255),
    conversation_id varchar(255),
    record_number int,
    angler_name_raw varchar(255),
    fish_species_name_raw varchar(255),
    body_of_water_name_raw varchar(255),
    airtable_id varchar(255) NOT NULL,
    airtable_created_datetime TIMESTAMP,
    airtable_last_updated_datetime TIMESTAMP, 
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS airtable_backup.catches_testing (
    id SERIAL PRIMARY KEY,
    catch_id varchar(255) NOT NULL,
    status varchar(255) NOT NULL,
    record_source varchar(255) NOT NULL,
    angler_id varchar(255),
    angler_name varchar(255),
    fish_species_id varchar(255),
    fish_species_name varchar(255),
    body_of_water_id varchar(255),
    body_of_water_name varchar(255),
    caught_when TIMESTAMP,
    length_in_inches FLOAT, 
    water_depth_in_feet FLOAT,
    notes TEXT,
    conversation_airtable_id varchar(255),
    conversation_id varchar(255),
    record_number int,
    angler_name_raw varchar(255),
    fish_species_name_raw varchar(255),
    body_of_water_name_raw varchar(255),
    airtable_id varchar(255) NOT NULL,
    airtable_created_datetime TIMESTAMP,
    airtable_last_updated_datetime TIMESTAMP, 
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS airtable_backup.catches_backup_20251123 (
    id SERIAL PRIMARY KEY,
    catch_id varchar(255) NOT NULL,
    status varchar(255) NOT NULL,
    record_source varchar(255) NOT NULL,
    angler_id varchar(255),
    angler_name varchar(255),
    fish_species_id varchar(255),
    fish_species_name varchar(255),
    body_of_water_id varchar(255),
    body_of_water_name varchar(255),
    caught_when TIMESTAMP,
    length_in_inches FLOAT, 
    water_depth_in_feet FLOAT,
    notes TEXT,
    conversation_airtable_id varchar(255),
    conversation_id varchar(255),
    record_number int,
    angler_name_raw varchar(255),
    fish_species_name_raw varchar(255),
    body_of_water_name_raw varchar(255),
    airtable_id varchar(255) NOT NULL,
    airtable_created_datetime TIMESTAMP,
    airtable_last_updated_datetime TIMESTAMP, 
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS airtable_backup.catches_backup_afterExcelLoad_20251123 (
    id SERIAL PRIMARY KEY,
    catch_id varchar(255) NOT NULL,
    status varchar(255) NOT NULL,
    record_source varchar(255) NOT NULL,
    angler_id varchar(255),
    angler_name varchar(255),
    fish_species_id varchar(255),
    fish_species_name varchar(255),
    body_of_water_id varchar(255),
    body_of_water_name varchar(255),
    caught_when TIMESTAMP,
    length_in_inches FLOAT, 
    water_depth_in_feet FLOAT,
    notes TEXT,
    conversation_airtable_id varchar(255),
    conversation_id varchar(255),
    record_number int,
    angler_name_raw varchar(255),
    fish_species_name_raw varchar(255),
    body_of_water_name_raw varchar(255),
    airtable_id varchar(255) NOT NULL,
    airtable_created_datetime TIMESTAMP,
    airtable_last_updated_datetime TIMESTAMP, 
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS airtable_backup.catch_media (
    id SERIAL PRIMARY KEY,
    media_id varchar(255) NOT NULL,
    airtable_catch_id varchar(255) NOT NULL,
    catch_id varchar(255) NOT NULL,
    blob_path varchar(255) NOT NULL,
    read_url varchar(255) NOT NULL,
    original_filename varchar(255) NOT NULL,
    media_type varchar(255) NOT NULL,
    content_type varchar(255) NOT NULL,
    file_size_bytes INT NOT NULL,
    uploaded_by varchar(255),
    uploaded_at TIMESTAMP,
    catch_id_raw varchar(255),
    record_number int,
    record_number_v2 int,
    airtable_id varchar(255) NOT NULL,
    airtable_created_datetime TIMESTAMP,
    airtable_last_updated_datetime TIMESTAMP, 
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);