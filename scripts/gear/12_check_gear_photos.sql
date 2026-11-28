-- Gear stage 3: checks the setup photo functions. Leaves nothing behind: it all runs in one
-- transaction that ends in ROLLBACK, and the catch number counter it uses is set back by hand.
-- No COMMIT anywhere in here. Records only: no files are made or deleted (that's the workflows').
--
-- Run on Staging after 11, 02 and vw_catch_details.sql, as the database admin. Expected: one
-- NOTICE per check, ending "all photo checks passed", then ROLLBACK. Not for production.
BEGIN;

DO $$
DECLARE
  a1 int; sp int; bw int;
  seq_last bigint; seq_called boolean;
  r jsonb; g int; c int;
  acct text := 'https://zzcheck.blob.core.windows.net/gear-media/';
  photo1 jsonb; photo2 jsonb; photo3 jsonb;
BEGIN
  SELECT last_value, is_called INTO seq_last, seq_called FROM catches_id_seq;
  BEGIN
  SELECT min(id) INTO a1 FROM anglers;
  SELECT min(id) INTO sp FROM fish_species;
  SELECT min(id) INTO bw FROM bodies_of_water;

  r := gear_save(jsonb_build_object('name', 'ZZ Photo-01', 'ownerAnglerId', a1, 'byAnglerId', a1));
  g := (r->>'id')::int;
  photo1 := jsonb_build_object('gearId', g, 'byAnglerId', a1, 'blobPath', format('gear/%s/AAAAAAAA1.jpg', g),
    'readUrl', acct || format('gear/%s/AAAAAAAA1.jpg', g), 'thumbnailUrl', acct || format('gear/%s/AAAAAAAA1-thumb.jpg', g),
    'viewingUrl', acct || format('gear/%s/AAAAAAAA1-view.jpg', g));
  photo2 := jsonb_set(jsonb_set(jsonb_set(jsonb_set(photo1, '{blobPath}', to_jsonb(format('gear/%s/BBBBBBBB2.heic', g))),
    '{readUrl}', to_jsonb(acct || format('gear/%s/BBBBBBBB2.heic', g))),
    '{thumbnailUrl}', to_jsonb(acct || format('gear/%s/BBBBBBBB2-thumb.jpg', g))),
    '{viewingUrl}', to_jsonb(acct || format('gear/%s/BBBBBBBB2-view.jpg', g)));
  photo3 := jsonb_set(jsonb_set(jsonb_set(jsonb_set(photo1, '{blobPath}', to_jsonb(format('gear/%s/CCCCCCCC3.png', g))),
    '{readUrl}', to_jsonb(acct || format('gear/%s/CCCCCCCC3.png', g))),
    '{thumbnailUrl}', to_jsonb(acct || format('gear/%s/CCCCCCCC3-thumb.jpg', g))),
    '{viewingUrl}', to_jsonb(acct || format('gear/%s/CCCCCCCC3-view.jpg', g)));

  -- Refused: a path for another tip-up, a URL outside gear-media
  r := gear_photo_save(jsonb_set(photo1, '{blobPath}', '"gear/999999/AAAAAAAA1.jpg"'));
  IF (r->>'success')::boolean THEN RAISE EXCEPTION 'path for another tip-up accepted'; END IF;
  IF jsonb_array_length(r->'removePaths') IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'refused save should list its 3 files: %', r; END IF;
  r := gear_photo_save(jsonb_set(photo1, '{thumbnailUrl}', '"https://zzcheck.blob.core.windows.net/catch-media/x.jpg"'));
  IF (r->>'success')::boolean THEN RAISE EXCEPTION 'URL outside gear-media accepted'; END IF;
  RAISE NOTICE 'ok: bad requests refused';

  -- A photo before any setup: an empty v1 holds it; nothing to delete
  r := gear_photo_save(photo1);
  IF NOT (r->>'success')::boolean OR r->'removePaths' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'first photo: %', r; END IF;
  IF (gear_get(g)->'tipUps'->0->'setup'->'photo'->>'thumbnailUrl') IS DISTINCT FROM photo1->>'thumbnailUrl' THEN RAISE EXCEPTION 'gear_get photo'; END IF;
  IF (gear_get(g)->'tipUps'->0->'setup'->>'versionNo')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'should be v1'; END IF;
  IF (gear_get(g)->'history'->0->>'newValue') IS DISTINCT FROM 'added' THEN RAISE EXCEPTION 'history should say added'; END IF;
  RAISE NOTICE 'ok: first photo on an empty v1';

  -- A catch on v1, then a setup change: v2 is made and carries the photo over
  INSERT INTO catches (record_source, angler_id, fish_species_id, body_of_water_id, caught_when, notes)
  VALUES ('Gear check', a1, sp, bw, now() - interval '1 hour', '[photo check, rolled back]') RETURNING id INTO c;
  PERFORM catch_gear_set(c, g, NULL, a1);
  r := gear_setup_save(jsonb_build_object('gearId', g, 'hook', 'ZZ photo hook', 'byAnglerId', a1));
  IF (gear_get(g)->'tipUps'->0->'setup'->>'versionNo')::int IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'setup change should make v2'; END IF;
  IF (gear_get(g)->'tipUps'->0->'setup'->'photo'->>'viewingUrl') IS DISTINCT FROM photo1->>'viewingUrl' THEN RAISE EXCEPTION 'photo not carried to v2'; END IF;
  RAISE NOTICE 'ok: a new version carries the photo';

  -- Replacing it on v2: v1 still uses the old files, so none are deleted; the catch keeps the old photo
  r := gear_photo_save(photo2);
  IF NOT (r->>'success')::boolean OR r->'removePaths' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'replace while v1 shares: %', r; END IF;
  IF (gear_get(g)->'tipUps'->0->'setup'->>'versionNo')::int IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'a photo must not make a version'; END IF;
  IF (gear_get(g)->'history'->0->>'newValue') IS DISTINCT FROM 'replaced' THEN RAISE EXCEPTION 'history should say replaced'; END IF;
  IF (SELECT caught_on->'photo'->>'thumbnailUrl' FROM vw_catch_details WHERE id = c) IS DISTINCT FROM photo1->>'thumbnailUrl'
    THEN RAISE EXCEPTION 'catch should keep v1''s photo'; END IF;
  RAISE NOTICE 'ok: replace keeps files another version uses; the catch keeps its photo';

  -- Replacing again: v2's photo2 is used nowhere else, so its 3 files are listed
  r := gear_photo_save(photo3);
  IF r->'removePaths' IS DISTINCT FROM gear_photo_paths(photo2->>'blobPath') THEN RAISE EXCEPTION 'replace should list photo2 files: %', r; END IF;
  RAISE NOTICE 'ok: replace lists the unused files';

  -- Remove: photo3's files listed, photo gone, history says removed; removing again is a no-op
  r := gear_photo_remove(jsonb_build_object('gearId', g, 'byAnglerId', a1));
  IF r->'removePaths' IS DISTINCT FROM gear_photo_paths(photo3->>'blobPath') THEN RAISE EXCEPTION 'remove: %', r; END IF;
  IF gear_get(g)->'tipUps'->0->'setup'->'photo' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'photo still there'; END IF;
  IF (gear_get(g)->'history'->0->>'newValue') IS DISTINCT FROM 'removed' THEN RAISE EXCEPTION 'history should say removed'; END IF;
  r := gear_photo_remove(jsonb_build_object('gearId', g));
  IF NOT (r->>'success')::boolean OR r->'removePaths' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'second remove: %', r; END IF;
  RAISE NOTICE 'ok: remove';

  -- Retired: refused, and the new files are listed for clean-up
  PERFORM gear_save(jsonb_build_object('id', g, 'name', 'ZZ Photo-01', 'ownerAnglerId', a1, 'status', 'Retired', 'byAnglerId', a1));
  r := gear_photo_save(photo1);
  IF (r->>'success')::boolean OR jsonb_array_length(r->'removePaths') IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'retired: %', r; END IF;
  RAISE NOTICE 'ok: retired tip-up refused';

  EXCEPTION WHEN OTHERS THEN
    PERFORM setval('catches_id_seq', seq_last, seq_called);
    RAISE;
  END;
  PERFORM setval('catches_id_seq', seq_last, seq_called);
  RAISE NOTICE 'all photo checks passed';
END $$;

ROLLBACK;
