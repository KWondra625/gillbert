-- One-time: add a UNIQUE constraint on anglers.name. Duplicate names weren't
-- a real risk while names were bare first names shared with Catch Chat's
-- aliases, but now that display names are disambiguated ("First L.", see
-- update_display_names.sql) it's worth enforcing at the DB level.
--
-- Safe to re-run: skips adding the constraint if it already exists.

-- ── Preview: any existing duplicate names would block this constraint ─────
SELECT name, COUNT(*), array_agg(id) AS angler_ids
FROM anglers
GROUP BY name
HAVING COUNT(*) > 1;

-- ── Fix: add the constraint (no-op if it already exists) ──────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'anglers_name_key'
    ) THEN
        ALTER TABLE anglers ADD CONSTRAINT anglers_name_key UNIQUE (name);
    END IF;
END $$;
