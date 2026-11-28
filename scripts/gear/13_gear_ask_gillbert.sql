-- Gear stage 5, second half: Ask Gillbert answers gear questions (docs/plans/gear-tip-ups.md).
-- Safe to re-run. Run as the database admin, after 01-04, 09 and 11, then 14 (rolled back).
--
-- Ask Gillbert's tools log in as gillbert_ai_reader, which can read only vw_catch_details
-- (scripts/roles/gillbert_ai_reader.sql). Rather than letting it read the gear tables, it gets
-- these two read-only functions, which run with their owner's rights and answer only what they
-- were written to answer:
--
--   gear_ai_stats(water, species, from, to)   fish by tip-up, bait and setup part; the same numbers
--                                              as the Gear Stats page (it calls gear_stats_get)
--   gear_ai_tipups(name)                       the tip-ups: owner, status, current setup, fish
--                                              caught, recent changes
--
-- Names come from the model, so they're matched loosely (case, spaces) and a name that matches
-- nothing says so instead of quietly answering for everything.

BEGIN;

-- water / species: names as Ask Gillbert says them (empty = all). from / to: 'YYYY-MM-DD' (empty = no limit).
-- Answer: { filters, fish, tipUps, sections: { tipUp, bait, hook, line, leader, bead, flash } },
-- each section its top 10 rows { name, owner?, none?, fish, biggest? }; or { error } for an unknown name.
CREATE OR REPLACE FUNCTION gear_ai_stats(p_water text DEFAULT '', p_species text DEFAULT '',
                                         p_from text DEFAULT '', p_to text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_water   int;
  v_species int;
  k         text := '';
  r         jsonb;
  out       jsonb := '{}'::jsonb;
  norm      text;
BEGIN
  IF coalesce(btrim(p_water), '') <> '' THEN
    norm := lower(regexp_replace(btrim(p_water), '\s+', ' ', 'g'));
    SELECT id INTO v_water FROM bodies_of_water
     WHERE lower(regexp_replace(name, '\s+', ' ', 'g')) = norm ORDER BY id LIMIT 1;
    IF v_water IS NULL THEN  -- "Kegonsa" for "Lake Kegonsa": one clear match only
      SELECT min(id) INTO v_water FROM bodies_of_water
       WHERE lower(name) LIKE '%' || norm || '%' HAVING count(*) = 1;
    END IF;
    IF v_water IS NULL THEN
      RETURN jsonb_build_object('error', format('No single body of water matches "%s".', p_water));
    END IF;
  END IF;
  IF coalesce(btrim(p_species), '') <> '' THEN
    norm := lower(regexp_replace(btrim(p_species), '\s+', ' ', 'g'));
    SELECT id INTO v_species FROM fish_species
     WHERE norm IN (lower(name), lower(coalesce(display_name_override, ''))) ORDER BY id LIMIT 1;
    IF v_species IS NULL THEN
      RETURN jsonb_build_object('error', format('No fish species is called "%s".', p_species));
    END IF;
  END IF;

  r := gear_stats_get(jsonb_strip_nulls(jsonb_build_object(
         'waterId', v_water, 'speciesId', v_species,
         'from', nullif(btrim(coalesce(p_from, '')), ''), 'to', nullif(btrim(coalesce(p_to, '')), ''))));

  FOR k IN SELECT jsonb_object_keys(r->'sections') LOOP
    out := out || jsonb_build_object(k, coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'name', e->>'name', 'owner', e->>'owner',
               'none', CASE WHEN (e->>'none')::boolean THEN true END,
               'fish', (e->>'fish')::int, 'biggest', e->'biggest')) ORDER BY n)
      FROM jsonb_array_elements(r->'sections'->k) WITH ORDINALITY x(e, n) WHERE n <= 10), '[]'::jsonb));
  END LOOP;

  RETURN jsonb_build_object(
    'filters', jsonb_strip_nulls(jsonb_build_object(
      'water', (SELECT name FROM bodies_of_water WHERE id = v_water),
      'species', (SELECT coalesce(display_name_override, name) FROM fish_species WHERE id = v_species),
      'from', nullif(btrim(coalesce(p_from, '')), ''), 'to', nullif(btrim(coalesce(p_to, '')), ''))),
    'fish', r->'fish', 'tipUps', r->'tipUps', 'sections', out,
    'note', 'Only catches logged on a tip-up count, each on the setup it had that day. A fish on two beads counts for both. Each section shows its top 10.');
END $$;

-- name: part of a tip-up's name, or its owner's name (empty = every tip-up).
-- Answer: [{ name, owner, model, color, status, retiredNote, notes, fish, lastFish,
--            setup: { version, line, leader, hook, beads, flash, hasPhoto, since },
--            recentChanges (when one tip-up matches): [{ at, by, what, from, to }] }]
CREATE OR REPLACE FUNCTION gear_ai_tipups(p_name text DEFAULT '') RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
WITH q AS (SELECT lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) AS s),
hit AS (
  SELECT t
  FROM jsonb_array_elements(gear_get()->'tipUps') t, q
  WHERE q.s = '' OR lower(t->>'name') LIKE '%' || q.s || '%' OR lower(t->>'ownerName') LIKE '%' || q.s || '%'
),
one AS (SELECT CASE WHEN count(*) = 1 THEN min((t->>'id')::int) END AS id FROM hit)
SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
  'name', t->>'name', 'owner', t->>'ownerName', 'model', t->>'model', 'color', t->>'color',
  'status', t->>'status', 'retiredNote', t->>'retiredNote', 'notes', t->>'notes',
  'fish', (SELECT count(*) FROM catches c JOIN gear_setups s ON s.id = c.gear_setup_id
            WHERE s.gear_id = (t->>'id')::int AND c.status = 'Active'),
  'lastFish', (SELECT max(c.caught_when) FROM catches c JOIN gear_setups s ON s.id = c.gear_setup_id
                WHERE s.gear_id = (t->>'id')::int AND c.status = 'Active'),
  'setup', CASE WHEN t->'setup' = 'null'::jsonb THEN NULL ELSE jsonb_build_object(
             'version', t->'setup'->'versionNo', 'line', t->'setup'->'line', 'leader', t->'setup'->'leader',
             'hook', t->'setup'->'hook', 'beads', t->'setup'->'beads', 'flash', t->'setup'->'flash',
             'hasPhoto', t->'setup'->'photo' <> 'null'::jsonb, 'since', t->'setup'->'since') END,
  'recentChanges', CASE WHEN (t->>'id')::int = (SELECT id FROM one) THEN (
             SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at', h->'at', 'by', h->'byName',
                      'what', h->>'field', 'from', h->'oldValue', 'to', h->'newValue')) ORDER BY n)
             FROM jsonb_array_elements(gear_get((t->>'id')::int)->'history') WITH ORDINALITY x(h, n)
             WHERE n <= 10) END
)) ORDER BY lower(t->>'name')), '[]'::jsonb)
FROM hit
$$;

-- Only Ask Gillbert's reader (and the owner) may call them
REVOKE ALL ON FUNCTION gear_ai_stats(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION gear_ai_tipups(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_fullaccess') THEN
    ALTER FUNCTION gear_ai_stats(text, text, text, text) OWNER TO gillbert_fullaccess;
    ALTER FUNCTION gear_ai_tipups(text) OWNER TO gillbert_fullaccess;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_ai_reader') THEN
    GRANT EXECUTE ON FUNCTION gear_ai_stats(text, text, text, text) TO gillbert_ai_reader;
    GRANT EXECUTE ON FUNCTION gear_ai_tipups(text) TO gillbert_ai_reader;
  END IF;
END $$;

COMMIT;

-- Check: the reader may call both, and still can't read the gear tables themselves
SELECT has_function_privilege('gillbert_ai_reader', 'gear_ai_stats(text, text, text, text)', 'EXECUTE') AS reader_stats,
       has_function_privilege('gillbert_ai_reader', 'gear_ai_tipups(text)', 'EXECUTE')                 AS reader_tipups,
       has_table_privilege('gillbert_ai_reader', 'gear', 'SELECT')                                       AS reader_reads_gear,
       jsonb_array_length(gear_ai_tipups(''))                                                            AS tipups;
