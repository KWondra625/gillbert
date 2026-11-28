-- Checks scripts/gear/13 (Ask Gillbert's gear functions). Leaves nothing behind: one transaction
-- that ends in ROLLBACK; no COMMIT in here. Run on Staging after 13, as the database admin.
-- Expected: one NOTICE per check, ending "all Ask Gillbert gear checks passed", then ROLLBACK.
BEGIN;

DO $$
DECLARE
  a1 int; sp int; bw int; spname text; bwname text;
  seq_last bigint; seq_called boolean;
  r jsonb; g int; c int;
BEGIN
  SELECT last_value, is_called INTO seq_last, seq_called FROM catches_id_seq;
  BEGIN
  SELECT min(id) INTO a1 FROM anglers;
  SELECT id, coalesce(display_name_override, name) INTO sp, spname FROM fish_species ORDER BY id LIMIT 1;
  SELECT id, name INTO bw, bwname FROM bodies_of_water ORDER BY id LIMIT 1;

  r := gear_save(jsonb_build_object('name', 'ZZ AskG-01', 'ownerAnglerId', a1, 'byAnglerId', a1));
  g := (r->>'id')::int;
  PERFORM gear_setup_save(jsonb_build_object('gearId', g, 'hook', 'ZZ askg hook', 'beads', jsonb_build_array('ZZ askg bead'), 'byAnglerId', a1));
  INSERT INTO catches (record_source, angler_id, fish_species_id, body_of_water_id, caught_when, length_in_inches, notes)
  VALUES ('Gear check', a1, sp, bw, '2026-12-10 15:00+00', 33, '[Ask Gillbert gear check, rolled back]') RETURNING id INTO c;
  PERFORM catch_gear_set(c, g, NULL, a1);

  -- Tip-ups: found by part of the name, with its setup, fish and (one match) its changes
  r := gear_ai_tipups('zz  askg');
  IF jsonb_array_length(r) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'one tip-up expected: %', r; END IF;
  IF r->0->>'name' IS DISTINCT FROM 'ZZ AskG-01' OR (r->0->>'fish')::int IS DISTINCT FROM 1
     OR r->0->'setup'->>'hook' IS DISTINCT FROM 'ZZ askg hook' OR r->0->'setup'->'beads' IS DISTINCT FROM '["ZZ askg bead"]'::jsonb
     OR (r->0->'setup'->>'hasPhoto')::boolean IS DISTINCT FROM false
     OR jsonb_array_length(r->0->'recentChanges') IS NULL THEN RAISE EXCEPTION 'tip-up: %', r; END IF;
  IF jsonb_array_length(gear_ai_tipups('')) < 1 OR gear_ai_tipups('zz no such tip-up') IS DISTINCT FROM '[]'::jsonb
    THEN RAISE EXCEPTION 'all / none'; END IF;
  RAISE NOTICE 'ok: tip-ups';

  -- Stats: the same counts as gear_stats_get, by name; an unknown name says so
  r := gear_ai_stats(bwname, upper(spname), '2026-12-01', '2026-12-31');
  IF r ? 'error' THEN RAISE EXCEPTION 'stats by name: %', r; END IF;
  IF r->'fish' IS DISTINCT FROM gear_stats_get(jsonb_build_object('waterId', bw, 'speciesId', sp, 'from', '2026-12-01', 'to', '2026-12-31'))->'fish'
    THEN RAISE EXCEPTION 'fish should match the page: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'sections'->'tipUp') e WHERE e->>'name' = 'ZZ AskG-01' AND (e->>'fish')::int = 1)
    THEN RAISE EXCEPTION 'tip-up row: %', r->'sections'->'tipUp'; END IF;
  IF r->'filters'->>'water' IS DISTINCT FROM bwname THEN RAISE EXCEPTION 'filters: %', r->'filters'; END IF;
  IF NOT gear_ai_stats('ZZ no such lake') ? 'error' OR NOT gear_ai_stats('', 'ZZ no such fish') ? 'error'
     OR NOT gear_ai_stats('', '', '2026-11-1') ? 'error' OR NOT gear_ai_stats('', '', '', '2027-02-29') ? 'error'
    THEN RAISE EXCEPTION 'unknown names should say so'; END IF;
  IF (SELECT max(jsonb_array_length(v)) FROM jsonb_each(gear_ai_stats()->'sections') x(k, v)) > 10
    THEN RAISE EXCEPTION 'sections should stop at 10'; END IF;
  RAISE NOTICE 'ok: stats';

  -- The reader may call them but not read the tables
  IF NOT has_function_privilege('gillbert_ai_reader', 'gear_ai_stats(text, text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('gillbert_ai_reader', 'gear_ai_tipups(text)', 'EXECUTE')
     OR has_table_privilege('gillbert_ai_reader', 'gear', 'SELECT')
     OR has_function_privilege('public', 'gear_ai_tipups(text)', 'EXECUTE')
    THEN RAISE EXCEPTION 'privileges'; END IF;
  RAISE NOTICE 'ok: privileges';

  EXCEPTION WHEN OTHERS THEN
    PERFORM setval('catches_id_seq', seq_last, seq_called);
    RAISE;
  END;
  PERFORM setval('catches_id_seq', seq_last, seq_called);
  RAISE NOTICE 'all Ask Gillbert gear checks passed';
END $$;

ROLLBACK;
