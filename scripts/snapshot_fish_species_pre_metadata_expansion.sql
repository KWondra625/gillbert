-- Safety snapshot: run this BEFORE add_fish_species_metadata_columns.sql and
-- upsert_fish_species_roster.sql, to capture fish_species exactly as it is today
-- (10 rows, original schema) in case anything about the roster expansion needs
-- to be unwound by hand.
--
-- This does not touch fish_species itself — it only creates a copy table.
--
-- To restore a specific row from the snapshot (e.g. if a rename went wrong):
--   SELECT * FROM fish_species_backup_20260803 WHERE id = <id>;
--   -- then manually UPDATE fish_species with the values shown.
--
-- Full rollback is intentionally not scripted here: catches.fish_species_id
-- references fish_species(id), and the migration only renames/updates existing
-- rows in place (never deletes them), so a blind TRUNCATE-and-restore would be
-- both riskier and unnecessary. Comparing against this backup table by id is
-- the safer path if something needs to be corrected.

CREATE TABLE IF NOT EXISTS fish_species_backup_20260803 AS
SELECT * FROM fish_species;
