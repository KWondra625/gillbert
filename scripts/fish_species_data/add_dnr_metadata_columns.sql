-- One-time migration: add the DNR-sourcing metadata columns and the
-- uniqueness guarantee `upsert_fish_species_roster.sql`'s
-- `ON CONFLICT (name)` depends on. Introduced alongside the fish species
-- roster expansion and admin UI (see fish_species_dnr_process.md) — this
-- migration script itself wasn't committed at the time, so it's added here
-- for repo completeness/reproducibility even though it's already been
-- applied to the live database by hand.
--
-- Safe to re-run (IF NOT EXISTS guards).

ALTER TABLE fish_species
    ADD COLUMN IF NOT EXISTS display_name_override varchar(255),
    ADD COLUMN IF NOT EXISTS family_display_name varchar(255),
    ADD COLUMN IF NOT EXISTS family_scientific_name varchar(255),
    ADD COLUMN IF NOT EXISTS dnr_url varchar(500);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fish_species_name_key'
    ) THEN
        ALTER TABLE fish_species ADD CONSTRAINT fish_species_name_key UNIQUE (name);
    END IF;
END $$;
