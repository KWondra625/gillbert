-- One-time migration: give each catch_media row a processing status, for the media
-- upload rework (#10). The row is now written as soon as an upload is recorded, not
-- after conversion, so it needs to say where it is:
--
--   submitted  → recorded and handed to the Convert Media workflow
--   processing → Convert Media has started on it
--   complete   → viewable (files that need no conversion are written as complete)
--   failed     → conversion failed; error_message says why, the original is kept
--
-- "Stuck" is not stored: vw_catch_media_details reports submitted/processing rows
-- whose status hasn't changed in 30 minutes as stuck.
--
-- Existing rows are all viewable, so they become complete (the default). The default
-- also keeps the legacy data load working unchanged.
--
-- Run on each server's database BEFORE that server gets the new media workflows and
-- views. The current site and workflows keep working after it.
-- Safe to re-run.

BEGIN;

ALTER TABLE catch_media
    ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'complete',
    ADD COLUMN IF NOT EXISTS error_message text,
    ADD COLUMN IF NOT EXISTS status_updated_at timestamptz DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE catch_media DROP CONSTRAINT IF EXISTS catch_media_status_check;
ALTER TABLE catch_media
    ADD CONSTRAINT catch_media_status_check
    CHECK (status IN ('submitted', 'processing', 'complete', 'failed'));

COMMIT;
