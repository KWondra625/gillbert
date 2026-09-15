-- One-time migration: add WI DNR 24K Hydro Waterbodies metadata columns to
-- bodies_of_water, ahead of admin CRUD + WBIC-linking support. wbic is the
-- durable external key; dnr_official_name/hydrotype/landlock_code/
-- shape_area/shape_len/river_sys_*/*_row_name are copied once from DNR's
-- ArcGIS layer via the dnr-search admin action, not live-queried on render.
-- Full column-by-column rationale is in the PR that introduced this file
-- ("Add admin CRUD and WI DNR WBIC linking for bodies of water").
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
