-- One-time (#19): rename anglers.name to anglers.display_name, so the column says what it
-- holds: the name shown everywhere ("Kurt W"). First names and nicknames stay in aliases.
--
-- Nothing a person sees changes. The three views that read it (vw_angler_details,
-- vw_catch_details, vw_catch_media_details) keep working through a rename (Postgres follows
-- the column, not its name) and keep handing it out under the same names (name,
-- angler_name, ...), so the site, Ask Gillbert and the listings are unaffected. Table grants
-- are kept too (a rename isn't a drop).
--
-- What does need changing, straight after this runs: the n8n steps that use the column
-- directly (see the release runbook: POST Update Angler, Catch Chat, GET Lookup Data,
-- Ask Gillbert, Convert Media; Legacy Data Load on Staging). Until they're updated, saving
-- an angler or a brand-new angler via Catch Chat fails; reads keep working.
--
-- Undo: rename_display_name_to_name.sql. Safe to re-run (does nothing once renamed).

BEGIN;

DO $$
BEGIN
  -- The live table only: weekly snapshot schemas hold their own copies of anglers
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'anglers' AND column_name = 'name') THEN
    ALTER TABLE anglers RENAME COLUMN name TO display_name;
    RAISE NOTICE 'anglers.name renamed to display_name';
  ELSE
    RAISE NOTICE 'anglers.name not found (already renamed?): nothing to do';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'anglers'::regclass AND conname = 'anglers_name_key') THEN
    ALTER TABLE anglers RENAME CONSTRAINT anglers_name_key TO anglers_display_name_key;
    RAISE NOTICE 'constraint anglers_name_key renamed to anglers_display_name_key';
  END IF;
END $$;

COMMIT;

-- Check: the column, the constraint, and the views still answering
SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'anglers' AND column_name IN ('name', 'display_name');
SELECT conname FROM pg_constraint WHERE conrelid = 'anglers'::regclass AND contype = 'u';
SELECT (SELECT count(*) FROM vw_angler_details) AS anglers_view_rows,
       (SELECT count(*) FROM vw_catch_details) AS catches_view_rows;
