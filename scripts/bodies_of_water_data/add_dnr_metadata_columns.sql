-- One-time migration: add WI DNR 24K Hydro Waterbodies metadata columns to
-- bodies_of_water, ahead of admin CRUD + WBIC-linking support. See
-- project_bodies_of_water_design.md (Claude's memory) for the full design
-- reasoning behind this column set.
--
-- Safe to re-run (IF NOT EXISTS guards).

ALTER TABLE bodies_of_water
    ADD COLUMN IF NOT EXISTS wbic integer,
    ADD COLUMN IF NOT EXISTS dnr_url_verified boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS dnr_official_name varchar(255),
    ADD COLUMN IF NOT EXISTS hydrotype smallint,
    ADD COLUMN IF NOT EXISTS landlock_code smallint,
    ADD COLUMN IF NOT EXISTS shape_area double precision,
    ADD COLUMN IF NOT EXISTS shape_len double precision,
    ADD COLUMN IF NOT EXISTS river_sys_name varchar(255),
    ADD COLUMN IF NOT EXISTS river_sys_wbic integer,
    ADD COLUMN IF NOT EXISTS river_row_name varchar(255),
    ADD COLUMN IF NOT EXISTS waterbody_row_name varchar(255);
