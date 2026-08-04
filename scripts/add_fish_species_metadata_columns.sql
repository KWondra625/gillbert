-- One-time migration: add fish species metadata columns ahead of expanding the
-- seeded species roster (display override, informal + scientific family
-- grouping, and a DNR reference link), plus a uniqueness constraint on name so
-- upsert_fish_species_roster.sql can be safely re-run over time.
--
-- Run this after snapshot_fish_species_pre_metadata_expansion.sql and before
-- upsert_fish_species_roster.sql.

ALTER TABLE fish_species
    ADD COLUMN IF NOT EXISTS display_name_override varchar(255),
    ADD COLUMN IF NOT EXISTS family_display_name varchar(255),
    ADD COLUMN IF NOT EXISTS family_scientific_name varchar(255),
    ADD COLUMN IF NOT EXISTS dnr_url varchar(500);

-- Guarded so this is harmless to run twice (plain ADD CONSTRAINT has no
-- IF NOT EXISTS option in Postgres).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fish_species_name_unique'
    ) THEN
        ALTER TABLE fish_species ADD CONSTRAINT fish_species_name_unique UNIQUE (name);
    END IF;
END $$;
