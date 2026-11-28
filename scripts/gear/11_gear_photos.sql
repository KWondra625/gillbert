-- Gear stage 3: setup photos (docs/plans/gear-tip-ups.md, "Stage 3").
-- Safe to re-run. Run as the database admin, in this order:
--   1. this script            (a column, the history type, the photo save / remove functions)
--   2. 02_gear_functions.sql  again (gear_get shows the photo; a new setup version carries it over)
--   3. scripts/views/vw_catch_details.sql  again (a catch's "Caught on" shows its setup's photo)
--   4. 12_check_gear_photos.sql (rolled back)
--
--   gear/photo-save     SELECT gear_photo_save($1::jsonb)     a new photo on the tip-up's current setup
--   gear/photo-remove   SELECT gear_photo_remove($1::jsonb)   take it off
--
-- A photo belongs to a setup VERSION, like a catch photo belongs to its catch. Adding,
-- replacing or removing one changes the current version in place (never a new version), and a
-- setup change carries the photo into the new version until someone replaces it, so several
-- versions can share one photo's files. Three files per photo, like catch photos: the original,
-- <ID>-thumb.jpg (1200 px) and <ID>-view.jpg (2048 px), in the gear-media storage container.
-- The workflows make and delete the files; these functions only record them and say which
-- files nothing uses any more ("removePaths"), so the workflow can delete those.

BEGIN;

ALTER TABLE gear_setups ADD COLUMN IF NOT EXISTS photo_viewing_url varchar(255);

-- 'photo' history lines: field 'photo', new_value added / replaced / removed.
-- 'fix' lines (review fix, 2026-11-28): a setup part corrected in place ("fixing a mistake"),
-- like 'setup' but marked, since it also changes what earlier catches on that version show.
ALTER TABLE gear_history DROP CONSTRAINT IF EXISTS gear_history_event_type_check;
ALTER TABLE gear_history ADD CONSTRAINT gear_history_event_type_check
  CHECK (event_type IN ('created', 'setup', 'fix', 'rename', 'owner', 'model', 'color', 'notes', 'retire', 'unretire', 'photo'));

-- A photo's three file paths (original, thumbnail, viewing copy) from the original's path
CREATE OR REPLACE FUNCTION gear_photo_paths(p_blob_path text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_blob_path IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
    p_blob_path,
    regexp_replace(p_blob_path, '\.[^.]+$', '') || '-thumb.jpg',
    regexp_replace(p_blob_path, '\.[^.]+$', '') || '-view.jpg') END
$$;

-- The files of a photo no setup version uses any more (none while another version still shows it)
CREATE OR REPLACE FUNCTION gear_photo_unused_paths(p_blob_path text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_blob_path IS NULL
                OR EXISTS (SELECT 1 FROM gear_setups WHERE photo_blob_path = p_blob_path)
              THEN '[]'::jsonb ELSE gear_photo_paths(p_blob_path) END
$$;

-- Body: { gearId, blobPath, readUrl, thumbnailUrl, viewingUrl, byAnglerId }
--   blobPath: gear/<gearId>/<ID>.<ext>, as the upload slot issued it (checked again here)
-- Answer: { success, message?, photo: {thumbnailUrl, viewingUrl, originalUrl}, removePaths }
--   removePaths: the replaced photo's files when nothing else uses them; on a refusal, the new
--   files when no setup uses them (so the workflow cleans up what it just made, and never a photo
--   a setup still shows: a replayed or stale request can name one), and only in this tip-up's folder
CREATE OR REPLACE FUNCTION gear_photo_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_gear int  := CASE WHEN p->>'gearId' ~ '^\d{1,9}$' THEN (p->>'gearId')::int END;
  v_by   int  := CASE WHEN p->>'byAnglerId' ~ '^\d{1,9}$' THEN (p->>'byAnglerId')::int END;
  v_path text := p->>'blobPath';
  g      gear%ROWTYPE;
  cur    gear_setups%ROWTYPE;
  v_old  text;
BEGIN
  IF v_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM anglers WHERE id = v_by) THEN v_by := NULL; END IF;
  IF v_path IS NULL OR v_path !~ ('^gear/' || coalesce(v_gear, -1) || '/[A-Z0-9]{8,24}\.(jpg|jpeg|png|webp|heic|heif)$')
     OR coalesce(p->>'thumbnailUrl', '') !~ '^https://[a-z0-9]+\.blob\.core\.windows\.net/gear-media/'
     OR coalesce(p->>'viewingUrl', '')   !~ '^https://[a-z0-9]+\.blob\.core\.windows\.net/gear-media/'
     OR coalesce(p->>'readUrl', '')      !~ '^https://[a-z0-9]+\.blob\.core\.windows\.net/gear-media/' THEN
    RETURN jsonb_build_object('success', false, 'message', 'That photo didn''t upload properly. Please try again.',
                              'removePaths', CASE WHEN v_path ~ ('^gear/' || coalesce(v_gear, -1) || '/[A-Z0-9]{8,24}\.[a-z]{3,4}$')
                                                  THEN gear_photo_unused_paths(v_path) ELSE '[]'::jsonb END);
  END IF;

  SELECT * INTO g FROM gear WHERE id = v_gear FOR UPDATE;
  IF NOT FOUND OR g.status = 'Retired' THEN
    RETURN jsonb_build_object('success', false, 'removePaths', gear_photo_unused_paths(v_path), 'message',
      CASE WHEN FOUND THEN 'This tip-up is retired, so its setup can''t change.' ELSE 'That tip-up no longer exists.' END);
  END IF;

  SELECT * INTO cur FROM gear_setups WHERE gear_id = v_gear ORDER BY version_no DESC LIMIT 1;
  IF NOT FOUND THEN
    -- A photo before any setup: an empty first version to hold it
    INSERT INTO gear_setups (gear_id, version_no, created_by_angler_id, updated_by_angler_id)
    VALUES (v_gear, 1, v_by, v_by) RETURNING * INTO cur;
  END IF;
  v_old := cur.photo_blob_path;

  UPDATE gear_setups
     SET photo_blob_path = v_path, photo_read_url = p->>'readUrl',
         photo_thumbnail_url = p->>'thumbnailUrl', photo_viewing_url = p->>'viewingUrl',
         photo_uploaded_at = now(), updated_by_angler_id = v_by, updated_at = now()
   WHERE id = cur.id;
  INSERT INTO gear_history (gear_id, event_type, field, old_value, new_value, by_angler_id)
  VALUES (v_gear, 'photo', 'photo', NULL, CASE WHEN v_old IS NULL THEN 'added' ELSE 'replaced' END, v_by);
  UPDATE gear SET updated_by_angler_id = v_by, updated_at = now() WHERE id = v_gear;

  RETURN jsonb_build_object('success', true,
    'photo', jsonb_build_object('thumbnailUrl', p->>'thumbnailUrl', 'viewingUrl', p->>'viewingUrl', 'originalUrl', p->>'readUrl'),
    'removePaths', CASE WHEN v_old = v_path THEN '[]'::jsonb ELSE gear_photo_unused_paths(v_old) END);
END $$;

-- Body: { gearId, byAnglerId }. Answer: { success, message?, removePaths }
CREATE OR REPLACE FUNCTION gear_photo_remove(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_gear int := CASE WHEN p->>'gearId' ~ '^\d{1,9}$' THEN (p->>'gearId')::int END;
  v_by   int := CASE WHEN p->>'byAnglerId' ~ '^\d{1,9}$' THEN (p->>'byAnglerId')::int END;
  g      gear%ROWTYPE;
  cur    gear_setups%ROWTYPE;
BEGIN
  IF v_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM anglers WHERE id = v_by) THEN v_by := NULL; END IF;
  SELECT * INTO g FROM gear WHERE id = v_gear FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'message', 'That tip-up no longer exists.', 'removePaths', '[]'::jsonb); END IF;
  IF g.status = 'Retired' THEN
    RETURN jsonb_build_object('success', false, 'message', 'This tip-up is retired, so its setup can''t change.', 'removePaths', '[]'::jsonb);
  END IF;
  SELECT * INTO cur FROM gear_setups WHERE gear_id = v_gear ORDER BY version_no DESC LIMIT 1;
  IF NOT FOUND OR cur.photo_blob_path IS NULL THEN
    RETURN jsonb_build_object('success', true, 'removePaths', '[]'::jsonb);   -- nothing to remove
  END IF;

  UPDATE gear_setups
     SET photo_blob_path = NULL, photo_read_url = NULL, photo_thumbnail_url = NULL, photo_viewing_url = NULL,
         photo_uploaded_at = NULL, updated_by_angler_id = v_by, updated_at = now()
   WHERE id = cur.id;
  INSERT INTO gear_history (gear_id, event_type, field, old_value, new_value, by_angler_id)
  VALUES (v_gear, 'photo', 'photo', NULL, 'removed', v_by);
  UPDATE gear SET updated_by_angler_id = v_by, updated_at = now() WHERE id = v_gear;

  RETURN jsonb_build_object('success', true, 'removePaths', gear_photo_unused_paths(cur.photo_blob_path));
END $$;

-- Same owner as the rest of the database (scripts/roles/gillbert_fullaccess.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_fullaccess') THEN
    ALTER FUNCTION gear_photo_paths(text) OWNER TO gillbert_fullaccess;
    ALTER FUNCTION gear_photo_unused_paths(text) OWNER TO gillbert_fullaccess;
    ALTER FUNCTION gear_photo_save(jsonb) OWNER TO gillbert_fullaccess;
    ALTER FUNCTION gear_photo_remove(jsonb) OWNER TO gillbert_fullaccess;
  END IF;
END $$;

COMMIT;

-- Check: the column is there, and a save for a tip-up that isn't there is refused with its files listed
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'gear_setups' AND column_name = 'photo_viewing_url') AS viewing_column,
       gear_photo_save('{"gearId": -1, "blobPath": "gear/-1/ABCDEFGH.jpg"}') ->> 'success' AS refused;
