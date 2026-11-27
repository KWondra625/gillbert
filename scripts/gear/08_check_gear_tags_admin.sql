-- Gear stage 6: checks the tag clean-up functions. Leaves nothing behind: it all runs in one
-- transaction that ends in ROLLBACK, and the catch number counter it uses is set back by hand.
-- No COMMIT anywhere in here.
--
-- Run on Staging after 07, as the database admin. Expected: one NOTICE per check, ending
-- "all tag checks passed", then ROLLBACK. Any failed check stops with an error (still rolled back).
-- Not for production.
BEGIN;

DO $$
DECLARE
  a1 int; sp int; bw int;
  seq_last bigint; seq_called boolean;
  r jsonb; g int; c int;
  hook_a int; hook_b int; bead_a int; bead_b int; bait_a int; bait_b int; line_x int;
BEGIN
  SELECT last_value, is_called INTO seq_last, seq_called FROM catches_id_seq;
  BEGIN
  SELECT min(id) INTO a1 FROM anglers;
  SELECT min(id) INTO sp FROM fish_species;
  SELECT min(id) INTO bw FROM bodies_of_water;

  -- A tip-up set up with the misspelled tags, and a catch on it with a misspelled bait
  r := gear_save(jsonb_build_object('name', 'ZZ Tags-01', 'ownerAnglerId', a1, 'byAnglerId', a1));
  g := (r->>'id')::int;
  r := gear_setup_save(jsonb_build_object('gearId', g, 'line', 'ZZ line x', 'hook', 'zz octopus #8',
                                          'beads', jsonb_build_array('zz glow', 'ZZ Glow Bead'), 'byAnglerId', a1));
  IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'setup failed: %', r; END IF;
  hook_a := gear_option_find_or_add('hook', 'zz octopus #8', a1);
  hook_b := gear_option_find_or_add('hook', 'ZZ #8 Octopus', a1);
  bead_a := gear_option_find_or_add('bead', 'zz glow', a1);
  bead_b := gear_option_find_or_add('bead', 'ZZ Glow Bead', a1);
  line_x := gear_option_find_or_add('line', 'ZZ line x', a1);
  INSERT INTO catches (record_source, angler_id, fish_species_id, body_of_water_id, caught_when, notes)
  VALUES ('Gear check', a1, sp, bw, now(), '[tag check, rolled back]') RETURNING id INTO c;
  PERFORM catch_gear_set(c, g, 'zz sucker', a1);
  bait_a := gear_option_find_or_add('bait', 'zz sucker', a1);
  bait_b := gear_option_find_or_add('bait', 'ZZ Sucker', a1);
  IF bait_a <> bait_b THEN RAISE EXCEPTION 'bait lookup should ignore capitals'; END IF;
  bait_b := gear_option_find_or_add('bait', 'ZZ Sucker (medium)', a1);

  -- The list counts uses
  IF (SELECT (t->>'tipUps')::int FROM jsonb_array_elements(gear_tags_get()) t WHERE (t->>'id')::int = hook_a) <> 1
    THEN RAISE EXCEPTION 'hook should be used by 1 tip-up'; END IF;
  IF (SELECT (t->>'catches')::int FROM jsonb_array_elements(gear_tags_get()) t WHERE (t->>'id')::int = bait_a) <> 1
    THEN RAISE EXCEPTION 'bait should be on 1 catch'; END IF;
  RAISE NOTICE 'ok: list counts tip-ups and catches';

  -- Rename: refused onto a name the kind already has, fine otherwise
  r := gear_tag_save(jsonb_build_object('id', hook_a, 'action', 'rename', 'name', 'zz #8 OCTOPUS'));
  IF (r->>'success')::boolean OR r->>'message' NOT LIKE '%Merge into it%' THEN RAISE EXCEPTION 'rename clash: %', r; END IF;
  r := gear_tag_save(jsonb_build_object('id', line_x, 'action', 'rename', 'name', '  ZZ Line   Y '));
  IF NOT (r->>'success')::boolean OR gear_option_name(line_x) <> 'ZZ Line Y' THEN RAISE EXCEPTION 'rename: %', r; END IF;
  RAISE NOTICE 'ok: rename';

  -- Hide / show
  PERFORM gear_tag_save(jsonb_build_object('id', line_x, 'action', 'hide'));
  IF (gear_get() -> 'options' -> 'line') ? 'ZZ Line Y' THEN RAISE EXCEPTION 'hidden tag still offered'; END IF;
  IF (gear_get(g) -> 'tipUps' -> 0 -> 'setup' ->> 'line') <> 'ZZ Line Y' THEN RAISE EXCEPTION 'hidden tag dropped from setup'; END IF;
  PERFORM gear_tag_save(jsonb_build_object('id', line_x, 'action', 'show'));
  IF NOT (gear_get() -> 'options' -> 'line') ? 'ZZ Line Y' THEN RAISE EXCEPTION 'shown tag not offered'; END IF;
  RAISE NOTICE 'ok: hide and show';

  -- Merge: setups, beads (the setup had both: keeps one), bait on the catch
  r := gear_tag_save(jsonb_build_object('id', hook_a, 'action', 'merge', 'intoId', hook_b));
  IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'merge hook: %', r; END IF;
  IF (gear_get(g) -> 'tipUps' -> 0 -> 'setup' ->> 'hook') <> 'ZZ #8 Octopus' THEN RAISE EXCEPTION 'hook not merged'; END IF;
  IF EXISTS (SELECT 1 FROM gear_options WHERE id = hook_a) THEN RAISE EXCEPTION 'merged tag left behind'; END IF;
  r := gear_tag_save(jsonb_build_object('id', bead_a, 'action', 'merge', 'intoId', bead_b));
  IF (gear_get(g) -> 'tipUps' -> 0 -> 'setup' -> 'beads') <> '["ZZ Glow Bead"]'::jsonb THEN
    RAISE EXCEPTION 'beads after merge: %', gear_get(g) -> 'tipUps' -> 0 -> 'setup' -> 'beads'; END IF;
  r := gear_tag_save(jsonb_build_object('id', bait_a, 'action', 'merge', 'intoId', bait_b));
  IF (SELECT bait_option_id FROM catches WHERE id = c) <> bait_b THEN RAISE EXCEPTION 'bait not merged'; END IF;
  r := gear_tag_save(jsonb_build_object('id', bait_b, 'action', 'merge', 'intoId', line_x));
  IF (r->>'success')::boolean THEN RAISE EXCEPTION 'merge across kinds allowed'; END IF;
  RAISE NOTICE 'ok: merge';

  -- Delete: refused while used, fine once unused
  r := gear_tag_save(jsonb_build_object('id', bait_b, 'action', 'delete'));
  IF (r->>'success')::boolean THEN RAISE EXCEPTION 'deleted a tag in use'; END IF;
  r := gear_tag_save(jsonb_build_object('id', gear_option_find_or_add('flash', 'ZZ unused flash', a1), 'action', 'delete'));
  IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'delete unused: %', r; END IF;
  RAISE NOTICE 'ok: delete';

  EXCEPTION WHEN OTHERS THEN
    PERFORM setval('catches_id_seq', seq_last, seq_called);
    RAISE;
  END;
  PERFORM setval('catches_id_seq', seq_last, seq_called);
  RAISE NOTICE 'all tag checks passed';
END $$;

ROLLBACK;
