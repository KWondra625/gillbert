-- Gear (stage 1): checks the database functions do what the plan says. Leaves nothing behind:
-- it all runs in one transaction that ends in ROLLBACK, and the catch number counter it uses
-- is set back by hand (counters don't roll back on their own). No COMMIT anywhere in here.
--
-- Run on Staging after 01 and 02, as the database admin. Expected: one NOTICE per check, ending
-- "all gear checks passed", then ROLLBACK. Any failed check stops with an error (still rolled back).
-- Uses the first angler, species and body of water as stand-ins; a test catch is added and
-- removed again by the rollback. Not for production.
BEGIN;

DO $$
DECLARE
  a1 int; a2 int; sp int; bw int;
  seq_last bigint; seq_called boolean;
  r jsonb; g int; g2 int; g3 int; v int; s1 int; c int;
  h text;
BEGIN
  SELECT last_value, is_called INTO seq_last, seq_called FROM catches_id_seq;
  BEGIN   -- inner block, so the counter is set back even when a check fails
  SELECT min(id) INTO a1 FROM anglers;
  SELECT min(id) INTO a2 FROM anglers WHERE id > a1;
  SELECT min(id) INTO sp FROM fish_species;
  SELECT min(id) INTO bw FROM bodies_of_water;

  -- Add
  r := gear_save(jsonb_build_object('name', '  ZZ  Check-01 ', 'ownerAnglerId', a1, 'model', 'Frabill Pro-Thermal',
                                    'color', 'blue', 'notes', '  Trigger sticks in the cold ', 'byAnglerId', a1));
  IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'add failed: %', r; END IF;
  g := (r->>'id')::int;
  IF (SELECT display_name FROM gear WHERE id = g) <> 'ZZ Check-01' THEN RAISE EXCEPTION 'name not cleaned'; END IF;
  IF (SELECT notes FROM gear WHERE id = g) <> 'Trigger sticks in the cold' THEN RAISE EXCEPTION 'notes not saved'; END IF;
  RAISE NOTICE 'ok: add (name trimmed and squeezed, notes saved)';

  -- Same name, other capitals and spaces: refused with the owner's name
  r := gear_save(jsonb_build_object('name', 'zz check-01', 'ownerAnglerId', a1));
  IF (r->>'success')::boolean OR r->>'message' NOT LIKE '%already taken%' THEN RAISE EXCEPTION 'duplicate allowed: %', r; END IF;
  RAISE NOTICE 'ok: duplicate refused: %', r->>'message';

  -- Bad requests answer with a message, not an error
  r := gear_save(jsonb_build_object('name', '', 'ownerAnglerId', a1));
  IF r->>'message' <> 'Please enter a name.' THEN RAISE EXCEPTION 'blank name: %', r; END IF;
  r := gear_save(jsonb_build_object('name', 'ZZ Check-02', 'ownerAnglerId', -1));
  IF r->>'message' <> 'Please choose an owner.' THEN RAISE EXCEPTION 'bad owner: %', r; END IF;
  RAISE NOTICE 'ok: blank name and unknown owner refused';

  -- Tags: "blue" and "BLUE " are one tag
  r := gear_save(jsonb_build_object('name', 'ZZ Check-02', 'ownerAnglerId', a1, 'color', 'BLUE '));
  g2 := (r->>'id')::int;
  IF (SELECT count(*) FROM gear_options WHERE kind = 'color' AND name_key = 'blue') <> 1 THEN RAISE EXCEPTION 'color tag duplicated'; END IF;
  RAISE NOTICE 'ok: tags match ignoring capitals and spaces';

  -- First setup: version 1, history from "none"
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'Dacron 30 lb', 'leader', 'Fluoro 10 lb', 'hook', '#8 Octopus',
                                          'beads', jsonb_build_array('Glow', 'glow'), 'flash', '[]'::jsonb, 'byAnglerId', a1));
  IF NOT (r->>'newVersion')::boolean OR (r->>'versionNo')::int <> 1 THEN RAISE EXCEPTION 'first setup: %', r; END IF;
  IF (SELECT count(*) FROM gear_history WHERE gear_id = g AND event_type = 'setup') <> 4 THEN
    RAISE EXCEPTION 'first setup history rows: %', (SELECT count(*) FROM gear_history WHERE gear_id = g AND event_type = 'setup');
  END IF;
  RAISE NOTICE 'ok: first setup is v1, with 4 history rows (line, leader, hook, beads; "Glow" once)';

  -- No change: nothing written
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'dacron 30 LB', 'leader', 'Fluoro 10 lb', 'hook', '#8 Octopus',
                                          'beads', jsonb_build_array('Glow'), 'byAnglerId', a1));
  IF (r->>'changed')::boolean THEN RAISE EXCEPTION 'unchanged setup counted as a change: %', r; END IF;
  RAISE NOTICE 'ok: saving the same setup changes nothing';

  -- "Fixing a mistake" within 2 hours of the last save: v1 corrected in place, history says fix
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'Dacron 30 lb', 'leader', 'Fluoro 10 lb', 'hook', '#6 Octopus',
                                          'beads', jsonb_build_array('Glow'), 'byAnglerId', a2, 'mode', 'fix'));
  IF (r->>'newVersion')::boolean OR (SELECT count(*) FROM gear_setups WHERE gear_id = g) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'fix in place: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM gear_history WHERE gear_id = g AND event_type = 'fix' AND field = 'hook') THEN RAISE EXCEPTION 'fix history'; END IF;
  RAISE NOTICE 'ok: a fix within 2 hours corrects v1 in place, marked as a fix';

  -- A catch on v1, then a change: v2 added, v1 left as it was
  SELECT id INTO s1 FROM gear_setups WHERE gear_id = g AND version_no = 1;
  INSERT INTO catches (record_source, angler_id, fish_species_id, body_of_water_id, caught_when, notes, gear_setup_id)
  VALUES ('Gear check', a1, sp, bw, now(), '[gear check, rolled back]', s1) RETURNING id INTO c;
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'Dacron 30 lb', 'leader', 'Fluoro 10 lb', 'hook', '#10 Treble',
                                          'beads', jsonb_build_array('Glow'), 'flash', jsonb_build_array('Gold blade'), 'byAnglerId', a2));
  IF NOT (r->>'newVersion')::boolean OR (r->>'versionNo')::int <> 2 THEN RAISE EXCEPTION 'new version: %', r; END IF;
  IF gear_option_name((SELECT hook_option_id FROM gear_setups WHERE id = s1)) <> '#6 Octopus' THEN RAISE EXCEPTION 'v1 changed'; END IF;
  IF (SELECT count(*) FROM gear_setup_options WHERE setup_id = s1) <> 1 THEN RAISE EXCEPTION 'v1 beads/flash changed'; END IF;
  RAISE NOTICE 'ok: once a catch uses v1, a change adds v2 and v1 stays as caught';

  -- gear_get shows v2 and the history, newest first
  r := gear_get(g);
  IF r #>> '{tipUps,0,setup,hook}' <> '#10 Treble' OR (r #>> '{tipUps,0,setup,versionNo}')::int <> 2 THEN RAISE EXCEPTION 'get: %', r->'tipUps'; END IF;
  IF (r #>> '{tipUps,0,catchCount}')::int <> 1 THEN RAISE EXCEPTION 'catch count: %', r #> '{tipUps,0}'; END IF;
  IF r #>> '{history,0,field}' NOT IN ('hook', 'flash') THEN RAISE EXCEPTION 'history order: %', r->'history'; END IF;
  RAISE NOTICE 'ok: gear_get: current setup v2, 1 catch, history newest first';
  IF (r #>> '{tipUps,0,setup,savedAt}') IS NULL THEN RAISE EXCEPTION 'savedAt missing: %', r #> '{tipUps,0,setup}'; END IF;

  -- 3 hours on: a fix is refused, unless an admin asks; a plain change makes a new version
  UPDATE gear_history SET at = at - interval '3 hours' WHERE gear_id = g;
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'Dacron 30 lb', 'leader', 'Fluoro 12 lb', 'hook', '#10 Treble',
                                          'beads', jsonb_build_array('Glow'), 'flash', jsonb_build_array('Gold blade'), 'byAnglerId', a2, 'mode', 'fix'));
  IF (r->>'success')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'a late fix should be refused: %', r; END IF;
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'Dacron 30 lb', 'leader', 'Fluoro 12 lb', 'hook', '#10 Treble',
                                          'beads', jsonb_build_array('Glow'), 'flash', jsonb_build_array('Gold blade'), 'byAnglerId', a2,
                                          'mode', 'fix', 'admin', true));
  IF (r->>'newVersion')::boolean OR (r->>'versionNo')::int IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'admin fix: %', r; END IF;
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'Dacron 30 lb', 'leader', 'Fluoro 15 lb', 'hook', '#10 Treble',
                                          'beads', jsonb_build_array('Glow'), 'flash', jsonb_build_array('Gold blade'), 'byAnglerId', a2));
  IF NOT (r->>'newVersion')::boolean OR (r->>'versionNo')::int IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'plain change, no catch: %', r; END IF;
  RAISE NOTICE 'ok: a late fix is refused (admins may); a change without "fix" is a new version, catch or not';

  -- A blank first version (made for a catch or a photo) with no catches is just filled in
  r := gear_save(jsonb_build_object('name', 'ZZ Check-03', 'ownerAnglerId', a1));
  g3 := (r->>'id')::int;
  INSERT INTO gear_setups (gear_id, version_no) VALUES (g3, 1);
  r := gear_setup_save(jsonb_build_object('gearId', g3, 'hook', '#8 Octopus', 'byAnglerId', a1));
  IF (r->>'newVersion')::boolean OR (r->>'versionNo')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'blank v1: %', r; END IF;
  RAISE NOTICE 'ok: a blank first version is filled in, not versioned';

  -- Delete refused once a catch uses it; retire instead, then setup changes are refused
  r := gear_save(jsonb_build_object('id', g, 'delete', true));
  IF (r->>'success')::boolean THEN RAISE EXCEPTION 'deleted a tip-up with a catch'; END IF;
  r := gear_save(jsonb_build_object('id', g, 'name', 'ZZ Check-01', 'ownerAnglerId', a2, 'status', 'Retired',
                                    'retiredNote', 'Lost down the hole', 'byAnglerId', a1));
  IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'retire: %', r; END IF;
  SELECT string_agg(event_type || ':' || coalesce(field, ''), ',' ORDER BY id) INTO h FROM gear_history WHERE gear_id = g AND event_type IN ('owner', 'notes', 'retire');
  IF h <> 'owner:owner,notes:notes,retire:status' THEN RAISE EXCEPTION 'retire history: %', h; END IF;
  r := gear_setup_save(jsonb_build_object('gearId', g, 'hook', '#2 Treble'));
  IF (r->>'success')::boolean THEN RAISE EXCEPTION 'retired tip-up setup changed'; END IF;
  RAISE NOTICE 'ok: delete refused with a catch; retire logged (owner + status); retired setup locked';

  -- The name of a retired tip-up stays taken
  r := gear_save(jsonb_build_object('name', 'ZZ CHECK-01', 'ownerAnglerId', a1));
  IF (r->>'success')::boolean THEN RAISE EXCEPTION 'retired name reused'; END IF;
  RAISE NOTICE 'ok: a retired name stays taken';

  -- A tip-up with no catches can be deleted, history and all
  r := gear_save(jsonb_build_object('id', g2, 'delete', true));
  IF NOT (r->>'success')::boolean OR EXISTS (SELECT 1 FROM gear_history WHERE gear_id = g2) THEN RAISE EXCEPTION 'delete: %', r; END IF;
  RAISE NOTICE 'ok: a tip-up with no catches deletes cleanly';

  EXCEPTION WHEN OTHERS THEN
    PERFORM setval('catches_id_seq', seq_last, seq_called);
    RAISE;
  END;
  -- The catch number counter goes back to where it was
  PERFORM setval('catches_id_seq', seq_last, seq_called);
  RAISE NOTICE 'all gear checks passed';
END $$;

ROLLBACK;
