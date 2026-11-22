-- Undo for rename_name_to_display_name.sql (#19): puts anglers.display_name back to
-- anglers.name. Only for a rollback: the n8n steps must go back to their pre-rename
-- versions at the same time. The n8n script and its backups are kept outside the repo;
-- the release runbook (Run Release - November Follow-ups) has the restore command.
-- Safe to re-run.

BEGIN;

DO $$
BEGIN
  -- The live table only: weekly snapshot schemas hold their own copies of anglers
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'anglers' AND column_name = 'display_name') THEN
    ALTER TABLE anglers RENAME COLUMN display_name TO name;
    RAISE NOTICE 'anglers.display_name renamed back to name';
  ELSE
    RAISE NOTICE 'anglers.display_name not found: nothing to do';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'anglers'::regclass AND conname = 'anglers_display_name_key') THEN
    ALTER TABLE anglers RENAME CONSTRAINT anglers_display_name_key TO anglers_name_key;
  END IF;
END $$;

COMMIT;
