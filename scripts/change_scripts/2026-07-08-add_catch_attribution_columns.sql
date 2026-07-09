--Run once against prod to add attribution columns to an existing catches table.
--Safe to re-run: IF NOT EXISTS guards against double-adding the columns.
--These track who logged/last edited the record via the app (Cloudflare identity),
--NOT who caught the fish (that's the existing angler_id column).
ALTER TABLE catches ADD COLUMN IF NOT EXISTS created_by_angler_id INT REFERENCES anglers(id);
ALTER TABLE catches ADD COLUMN IF NOT EXISTS updated_by_angler_id INT REFERENCES anglers(id);
