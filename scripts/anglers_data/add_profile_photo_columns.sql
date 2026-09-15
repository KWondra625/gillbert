-- One-time migration: add angler profile-photo columns, ahead of the
-- angler-media upload workflows (get-sas/commit/remove) and the
-- anglers-listing card redesign. Exactly one active photo per angler --
-- these are plain nullable columns on anglers, not a child table like
-- catch_media, since there's no gallery concept here.
--
-- Safe to re-run (IF NOT EXISTS guards).

ALTER TABLE anglers
    ADD COLUMN IF NOT EXISTS profile_photo_blob_path varchar(255),
    ADD COLUMN IF NOT EXISTS profile_photo_read_url varchar(255),
    ADD COLUMN IF NOT EXISTS profile_photo_uploaded_at timestamptz;
