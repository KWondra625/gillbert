-- Gear stage 4: checks gear_stats_get(). Leaves nothing behind: it all runs in one transaction
-- that ends in ROLLBACK, and the catch number counter it uses is set back by hand.
-- No COMMIT anywhere in here.
--
-- Run on Staging after 09, as the database admin. Expected: one NOTICE per check, ending
-- "all stats checks passed", then ROLLBACK. Any failed check stops with an error (still rolled back).
-- Real catches on Staging are counted too, so the checks look only at the test rows, or at how
-- much a count went up. Not for production.
BEGIN;

DO $$
DECLARE
  a1 int; sp1 int; sp2 int; bw int;
  seq_last bigint; seq_called boolean;
  r jsonb; g int; c1 int; c2 int;
  before jsonb; after jsonb;
  row_ jsonb;
BEGIN
  SELECT last_value, is_called INTO seq_last, seq_called FROM catches_id_seq;
  BEGIN
  SELECT min(id) INTO a1 FROM anglers;
  SELECT min(id) INTO sp1 FROM fish_species;
  SELECT min(id) INTO sp2 FROM fish_species WHERE id > sp1;
  SELECT min(id) INTO bw FROM bodies_of_water;
  before := gear_stats_get();

  -- A tip-up: v1 with hook A and a glow bead, no flash. Catch 1 (20", Jan 2020) on v1.
  r := gear_save(jsonb_build_object('name', 'ZZ Stats-01', 'ownerAnglerId', a1, 'byAnglerId', a1));
  g := (r->>'id')::int;
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'ZZ stats line', 'hook', 'ZZ stats hook A',
                                          'beads', jsonb_build_array('ZZ stats glow'), 'byAnglerId', a1));
  IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'setup v1 failed: %', r; END IF;
  INSERT INTO catches (record_source, angler_id, fish_species_id, body_of_water_id, caught_when, length_in_inches, notes)
  VALUES ('Gear check', a1, sp1, bw, '2020-01-15 12:00+00', 20, '[stats check, rolled back]') RETURNING id INTO c1;
  PERFORM catch_gear_set(c1, g, 'ZZ stats sucker', a1);

  -- v2: hook B, no beads, one flash. Catch 2 (30", now, another species) on v2.
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'ZZ stats line', 'hook', 'ZZ stats hook B',
                                          'beads', '[]'::jsonb, 'flash', jsonb_build_array('ZZ stats blade'),
                                          'byAnglerId', a1));
  IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'setup v2 failed: %', r; END IF;
  INSERT INTO catches (record_source, angler_id, fish_species_id, body_of_water_id, caught_when, length_in_inches, notes)
  VALUES ('Gear check', a1, sp2, bw, now(), 30, '[stats check, rolled back]') RETURNING id INTO c2;
  PERFORM catch_gear_set(c2, g, 'ZZ stats sucker', a1);
  IF (SELECT count(DISTINCT gear_setup_id) FROM catches WHERE id IN (c1, c2)) <> 2 THEN
    RAISE EXCEPTION 'the two catches should be on two setup versions'; END IF;

  after := gear_stats_get();

  -- Totals went up by the two fish and the one tip-up
  IF (after->>'fish')::int - (before->>'fish')::int <> 2 THEN RAISE EXCEPTION 'fish total: % -> %', before->'fish', after->'fish'; END IF;
  IF (after->>'tipUps')::int - (before->>'tipUps')::int <> 1 THEN RAISE EXCEPTION 'tip-up total'; END IF;
  RAISE NOTICE 'ok: totals';

  -- The tip-up: 2 fish, biggest is the 30"
  SELECT t INTO row_ FROM jsonb_array_elements(after->'sections'->'tipUp') t WHERE t->>'name' = 'ZZ Stats-01';
  IF (row_->>'fish')::int <> 2 THEN RAISE EXCEPTION 'tip-up row: %', row_; END IF;
  IF (row_->'biggest'->>'length')::numeric <> 30 THEN RAISE EXCEPTION 'biggest: %', row_; END IF;
  IF row_->>'owner' IS NULL THEN RAISE EXCEPTION 'tip-up row has no owner'; END IF;
  RAISE NOTICE 'ok: tip-up row';

  -- Each fish stays with the version it was caught on: hook A 1 (20"), hook B 1 (30")
  SELECT t INTO row_ FROM jsonb_array_elements(after->'sections'->'hook') t WHERE t->>'name' = 'ZZ stats hook A';
  IF (row_->>'fish')::int <> 1 OR (row_->'biggest'->>'length')::numeric <> 20 THEN RAISE EXCEPTION 'hook A: %', row_; END IF;
  SELECT t INTO row_ FROM jsonb_array_elements(after->'sections'->'hook') t WHERE t->>'name' = 'ZZ stats hook B';
  IF (row_->>'fish')::int <> 1 THEN RAISE EXCEPTION 'hook B: %', row_; END IF;
  SELECT t INTO row_ FROM jsonb_array_elements(after->'sections'->'line') t WHERE t->>'name' = 'ZZ stats line';
  IF (row_->>'fish')::int <> 2 THEN RAISE EXCEPTION 'line: %', row_; END IF;
  SELECT t INTO row_ FROM jsonb_array_elements(after->'sections'->'bait') t WHERE t->>'name' = 'ZZ stats sucker';
  IF (row_->>'fish')::int <> 2 THEN RAISE EXCEPTION 'bait: %', row_; END IF;
  RAISE NOTICE 'ok: hooks, line and bait by version';

  -- Beads and flash: one with, one without, each
  SELECT t INTO row_ FROM jsonb_array_elements(after->'sections'->'bead') t WHERE t->>'name' = 'ZZ stats glow';
  IF (row_->>'fish')::int <> 1 THEN RAISE EXCEPTION 'glow bead: %', row_; END IF;
  SELECT t INTO row_ FROM jsonb_array_elements(after->'sections'->'flash') t WHERE t->>'name' = 'ZZ stats blade';
  IF (row_->>'fish')::int <> 1 THEN RAISE EXCEPTION 'blade: %', row_; END IF;
  IF coalesce((SELECT (t->>'fish')::int FROM jsonb_array_elements(after->'sections'->'bead') t WHERE (t->>'none')::boolean), 0)
   - coalesce((SELECT (t->>'fish')::int FROM jsonb_array_elements(before->'sections'->'bead') t WHERE (t->>'none')::boolean), 0) <> 1
    THEN RAISE EXCEPTION 'No beads should go up by 1'; END IF;
  IF coalesce((SELECT (t->>'fish')::int FROM jsonb_array_elements(after->'sections'->'flash') t WHERE (t->>'none')::boolean), 0)
   - coalesce((SELECT (t->>'fish')::int FROM jsonb_array_elements(before->'sections'->'flash') t WHERE (t->>'none')::boolean), 0) <> 1
    THEN RAISE EXCEPTION 'No flash should go up by 1'; END IF;
  IF (SELECT t->>'name' FROM jsonb_array_elements(after->'sections'->'bead') t WHERE (t->>'none')::boolean) <> 'No beads'
    THEN RAISE EXCEPTION 'No beads row name'; END IF;
  RAISE NOTICE 'ok: beads and flash, with and without';

  -- Filters: species, lake, dates; the filter lists include the test catch's lake and species
  r := gear_stats_get(jsonb_build_object('speciesId', sp2));
  IF (SELECT (t->>'fish')::int FROM jsonb_array_elements(r->'sections'->'tipUp') t WHERE t->>'name' = 'ZZ Stats-01') <> 1
    THEN RAISE EXCEPTION 'species filter'; END IF;
  r := gear_stats_get(jsonb_build_object('from', '2020-01-01', 'to', '2020-01-15'));
  SELECT t INTO row_ FROM jsonb_array_elements(r->'sections'->'tipUp') t WHERE t->>'name' = 'ZZ Stats-01';
  IF (row_->>'fish')::int <> 1 OR (row_->'biggest'->>'length')::numeric <> 20 THEN RAISE EXCEPTION 'date filter: %', row_; END IF;
  r := gear_stats_get(jsonb_build_object('waterId', -5));
  IF (r->>'fish')::int <> (after->>'fish')::int THEN RAISE EXCEPTION 'a bad lake id should be ignored'; END IF;
  r := gear_stats_get(jsonb_build_object('waterId', bw));
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'sections'->'tipUp') t WHERE t->>'name' = 'ZZ Stats-01')
    THEN RAISE EXCEPTION 'lake filter'; END IF;
  IF NOT (after->'waters') @> jsonb_build_array(jsonb_build_object('id', bw)) THEN RAISE EXCEPTION 'waters list'; END IF;
  IF NOT (after->'species') @> jsonb_build_array(jsonb_build_object('id', sp2)) THEN RAISE EXCEPTION 'species list'; END IF;
  RAISE NOTICE 'ok: filters';

  -- A tip-up nobody set up: its catch counts for the tip-up, but not as No beads / No flash
  r := gear_save(jsonb_build_object('name', 'ZZ Stats-02', 'ownerAnglerId', a1, 'byAnglerId', a1));
  INSERT INTO catches (record_source, angler_id, fish_species_id, body_of_water_id, caught_when, notes)
  VALUES ('Gear check', a1, sp1, bw, now(), '[stats check, rolled back]') RETURNING id INTO c1;
  PERFORM catch_gear_set(c1, (r->>'id')::int, NULL, a1);
  before := after;
  after := gear_stats_get();
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(after->'sections'->'tipUp') t WHERE t->>'name' = 'ZZ Stats-02')
    THEN RAISE EXCEPTION 'tip-up with no setup missing'; END IF;
  IF coalesce((SELECT (t->>'fish')::int FROM jsonb_array_elements(after->'sections'->'bead') t WHERE (t->>'none')::boolean), 0)
   <> coalesce((SELECT (t->>'fish')::int FROM jsonb_array_elements(before->'sections'->'bead') t WHERE (t->>'none')::boolean), 0)
    THEN RAISE EXCEPTION 'a setup nobody entered counted as No beads'; END IF;
  RAISE NOTICE 'ok: a setup nobody entered isn''t None';

  -- An inactive catch drops out
  UPDATE catches SET status = 'Inactive' WHERE id = c2;
  IF (gear_stats_get()->>'fish')::int <> (after->>'fish')::int - 1 THEN RAISE EXCEPTION 'inactive catch counted'; END IF;
  RAISE NOTICE 'ok: inactive catches left out';

  EXCEPTION WHEN OTHERS THEN
    PERFORM setval('catches_id_seq', seq_last, seq_called);
    RAISE;
  END;
  PERFORM setval('catches_id_seq', seq_last, seq_called);
  RAISE NOTICE 'all stats checks passed';
END $$;

ROLLBACK;
