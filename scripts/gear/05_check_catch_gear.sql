-- Gear (stage 2): checks catch_gear_set and the view's new columns. Leaves nothing behind:
-- one transaction that ends in ROLLBACK, and the catch number counter is set back by hand
-- (counters don't roll back on their own). No COMMIT anywhere in here.
--
-- Run on Staging after 04 and scripts/views/vw_catch_details.sql, as the database admin.
-- Expected: one NOTICE per check, ending "all catch gear checks passed", then ROLLBACK.
-- Uses the first angler, species and body of water as stand-ins. Not for production.
BEGIN;

DO $$
DECLARE
  a1 int; sp int; bw int;
  seq_last bigint; seq_called boolean;
  r jsonb; g int; g2 int; s1 int; s2 int; c int; cr catches;
  v jsonb;
BEGIN
  SELECT last_value, is_called INTO seq_last, seq_called FROM catches_id_seq;
  BEGIN   -- inner block, so the counter is set back even when a check fails
  SELECT min(id) INTO a1 FROM anglers;
  SELECT min(id) INTO sp FROM fish_species;
  SELECT min(id) INTO bw FROM bodies_of_water;

  -- A tip-up with two setup versions: v1 from Jan 10, v2 from Jan 12 (dates set by hand,
  -- since everything in one transaction shares one clock)
  r := gear_save(jsonb_build_object('name', 'ZZ Check-11', 'ownerAnglerId', a1, 'byAnglerId', a1));
  g := (r->>'id')::int;
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'Dacron 30 lb', 'hook', '#8 Octopus',
                                          'beads', jsonb_build_array('Glow'), 'byAnglerId', a1));
  s1 := (SELECT id FROM gear_setups WHERE gear_id = g AND version_no = 1);
  UPDATE gear_setups SET created_at = '2027-01-10 08:00-06' WHERE id = s1;
  INSERT INTO gear_setups (gear_id, version_no, hook_option_id, created_at)
  VALUES (g, 2, gear_option_find_or_add('hook', '#10 Treble', a1), '2027-01-12 08:00-06') RETURNING id INTO s2;

  -- A catch on Jan 11 evening gets v1; moved to Jan 13 it gets v2
  INSERT INTO catches (record_source, angler_id, fish_species_id, body_of_water_id, caught_when, notes)
  VALUES ('Gear check', a1, sp, bw, '2027-01-11 19:30-06', '[catch gear check, rolled back]') RETURNING id INTO c;
  SELECT * INTO cr FROM catch_gear_set(c, g, '  shiner (MEDIUM) ', a1);
  IF cr.gear_setup_id <> s1 THEN RAISE EXCEPTION 'Jan 11 catch got setup %, expected v1 %', cr.gear_setup_id, s1; END IF;
  IF cr.bait_option_id <> (SELECT id FROM gear_options WHERE kind = 'bait' AND name_key = 'shiner (medium)') THEN
    RAISE EXCEPTION 'bait did not match the existing "Shiner (medium)"';
  END IF;
  RAISE NOTICE 'ok: version by catch time (v1), bait matched ignoring capitals and spaces';

  UPDATE catches SET caught_when = '2027-01-13 07:00-06' WHERE id = c;
  SELECT * INTO cr FROM catch_gear_set(c, g, 'Shiner (medium)', a1);
  IF cr.gear_setup_id <> s2 THEN RAISE EXCEPTION 'Jan 13 catch got setup %, expected v2 %', cr.gear_setup_id, s2; END IF;
  RAISE NOTICE 'ok: changing the catch time picks the version in use then (v2)';

  -- Caught before the first version was entered: the first version
  UPDATE catches SET caught_when = '2027-01-01 07:00-06' WHERE id = c;
  SELECT * INTO cr FROM catch_gear_set(c, g, NULL, a1);
  IF cr.gear_setup_id <> s1 OR cr.bait_option_id IS NOT NULL THEN RAISE EXCEPTION 'early catch: %, bait %', cr.gear_setup_id, cr.bait_option_id; END IF;
  RAISE NOTICE 'ok: caught before any version uses v1; blank bait clears it';

  -- A brand-new bait becomes a choice
  SELECT * INTO cr FROM catch_gear_set(c, g, 'ZZ Check Bait', a1);
  IF NOT EXISTS (SELECT 1 FROM gear_options WHERE kind = 'bait' AND name = 'ZZ Check Bait') THEN RAISE EXCEPTION 'new bait not added'; END IF;
  RAISE NOTICE 'ok: a new bait is added as a choice';

  -- A tip-up with no setup yet gets an empty v1 to point at
  r := gear_save(jsonb_build_object('name', 'ZZ Check-12', 'ownerAnglerId', a1, 'byAnglerId', a1));
  g2 := (r->>'id')::int;
  SELECT * INTO cr FROM catch_gear_set(c, g2, NULL, a1);
  IF cr.gear_setup_id IS NULL OR (SELECT version_no FROM gear_setups WHERE id = cr.gear_setup_id) <> 1 THEN
    RAISE EXCEPTION 'no-setup tip-up: %', cr.gear_setup_id;
  END IF;
  RAISE NOTICE 'ok: a tip-up with no setup gets an empty v1';

  -- Unknown tip-up, or none: "Caught on" is cleared, nothing fails
  SELECT * INTO cr FROM catch_gear_set(c, -1, NULL, a1);
  IF cr.gear_setup_id IS NOT NULL THEN RAISE EXCEPTION 'unknown tip-up kept a setup'; END IF;
  SELECT * INTO cr FROM catch_gear_set(c, NULL, NULL, a1);
  IF cr.gear_setup_id IS NOT NULL THEN RAISE EXCEPTION 'no tip-up kept a setup'; END IF;
  RAISE NOTICE 'ok: unknown or no tip-up clears it without failing';

  -- The view shows the version as caught, and the bait
  UPDATE catches SET caught_when = '2027-01-11 19:30-06', status = 'Active' WHERE id = c;
  PERFORM catch_gear_set(c, g, 'Sucker (large)', a1);
  SELECT caught_on INTO v FROM vw_catch_details WHERE id = c;
  IF v->>'name' <> 'ZZ Check-11' OR (v->>'versionNo')::int <> 1 OR v->>'hook' <> '#8 Octopus'
     OR v->'beads' <> '["Glow"]'::jsonb OR v->'flash' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'view caught_on: %', v;
  END IF;
  IF (SELECT bait_name FROM vw_catch_details WHERE id = c) <> 'Sucker (large)' THEN RAISE EXCEPTION 'view bait_name'; END IF;
  RAISE NOTICE 'ok: the view shows v1 as caught (#8 Octopus, Glow) and the bait';

  -- A setup change after the catch adds a version; the catch still shows what it was caught on
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'Dacron 30 lb', 'hook', 'Quick-strike', 'byAnglerId', a1));
  IF (SELECT caught_on->>'hook' FROM vw_catch_details WHERE id = c) <> '#8 Octopus' THEN RAISE EXCEPTION 'catch setup changed with the tip-up'; END IF;
  RAISE NOTICE 'ok: changing the tip-up later leaves the catch''s setup as caught';

  EXCEPTION WHEN OTHERS THEN
    PERFORM setval('catches_id_seq', seq_last, seq_called);
    RAISE;
  END;
  PERFORM setval('catches_id_seq', seq_last, seq_called);
  RAISE NOTICE 'all catch gear checks passed';
END $$;

ROLLBACK;
