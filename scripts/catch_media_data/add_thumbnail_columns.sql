-- One-time migration: thumbnails for catch media (#38). Each photo gets a small thumbnail
-- (tiles, home card) and a mid-size viewing copy (lightbox); each video gets a poster frame
-- (its thumbnail, no viewing copy). Made by the "Gillbert - Media - Make Thumbnails"
-- workflow at upload or from Media Activity.
--
--   thumbnail_url, viewing_url  null until made; pages use the original until then
--   thumbnail_error             why the last attempt failed (null after a success)
--   thumbnails_updated_at       when the last attempt finished
--
-- Existing rows start with no thumbnails (Media Activity lists them as missing).
-- Run on each server's database BEFORE that server gets the new view and workflows.
-- The current site and workflows keep working after it. Safe to re-run.

BEGIN;

ALTER TABLE catch_media
    ADD COLUMN IF NOT EXISTS thumbnail_url varchar(255),
    ADD COLUMN IF NOT EXISTS viewing_url varchar(255),
    ADD COLUMN IF NOT EXISTS thumbnail_error text,
    ADD COLUMN IF NOT EXISTS thumbnails_updated_at timestamptz;

COMMIT;
