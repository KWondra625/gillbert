-- Gear stage 4: the Gear Stats page (docs/plans/gear-tip-ups.md, "Stage 4").
-- Safe to re-run (CREATE OR REPLACE). Run after 01-04, as the database admin. Reads only.
--
--   gear/stats   SELECT gear_stats_get($1::jsonb)   fish by tip-up, bait and setup part
--
-- Only catches logged on a tip-up count (a catch with no tip-up has nothing to slice by), and
-- each one counts for the setup VERSION it was caught on, so changing a hook later doesn't move
-- old fish. Beads and flash can be none: a catch whose setup had none counts under "No beads" /
-- "No flash" (a setup nobody entered isn't none). A fish on two beads counts under both, so a section's counts can add up to more
-- than the fish. Line, leader and hook are always on the tip-up, so a blank one is just not
-- entered and isn't counted.

-- Body (all optional): { waterId, speciesId, from, to }   from / to: 'YYYY-MM-DD', to inclusive
-- Answer: { fish, tipUps, waters: [{id, name}], species: [{id, name}],
--           sections: { tipUp, bait, hook, line, leader, bead, flash: [row...] } }
--   row: { id, name, owner (tip-ups), none (the No beads / No flash row), fish,
--          biggest: { catchNumber, length, species, angler, caughtWhen } or null }
-- waters / species are every lake and species with a tip-up catch, for the filters, unfiltered.
-- 'YYYY-MM-DD' to a date; anything else (a bad shape, or a day that doesn't exist) is NULL
BEGIN;

CREATE OR REPLACE FUNCTION gear_safe_date(p text) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  RETURN p::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION gear_stats_get(p jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
WITH f AS (
  SELECT CASE WHEN p->>'waterId'   ~ '^\d{1,9}$' THEN (p->>'waterId')::int END   AS water_id,
         CASE WHEN p->>'speciesId' ~ '^\d{1,9}$' THEN (p->>'speciesId')::int END AS species_id,
         gear_safe_date(p->>'from') AS d_from,
         gear_safe_date(p->>'to')   AS d_to
),
-- Every active catch on a tip-up, before the filters (for the filter lists)
on_gear AS (
  SELECT c.id, c.catch_number, c.length_in_inches, c.caught_when, c.bait_option_id,
         c.body_of_water_id, c.fish_species_id, s.id AS setup_id, s.line_option_id,
         s.leader_option_id, s.hook_option_id, g.id AS gear_id, g.display_name,
         ow.display_name AS owner, an.display_name AS angler, fs.name AS species
  FROM catches c
  JOIN gear_setups s ON s.id = c.gear_setup_id
  JOIN gear g ON g.id = s.gear_id
  JOIN anglers ow ON ow.id = g.owner_angler_id
  JOIN anglers an ON an.id = c.angler_id
  JOIN fish_species fs ON fs.id = c.fish_species_id
  WHERE c.status = 'Active'
),
cs AS (
  SELECT o.* FROM on_gear o, f
  WHERE (f.water_id   IS NULL OR o.body_of_water_id = f.water_id)
    AND (f.species_id IS NULL OR o.fish_species_id  = f.species_id)
    -- Days as the crew lives them (Central), like the catch views, whatever the session's time zone
    AND (f.d_from IS NULL OR (o.caught_when AT TIME ZONE 'America/Chicago')::date >= f.d_from)
    AND (f.d_to   IS NULL OR (o.caught_when AT TIME ZONE 'America/Chicago')::date <= f.d_to)
),
-- One row per catch per thing it counts for: section, key, name
parts AS (
  SELECT cs.id AS catch_id, 'tipUp' AS section, cs.gear_id AS key_id, cs.display_name AS name,
         cs.owner, false AS is_none FROM cs
  UNION ALL
  SELECT cs.id, x.section, o.id, o.name, NULL, false
  FROM cs
  CROSS JOIN LATERAL (VALUES ('bait', cs.bait_option_id), ('hook', cs.hook_option_id),
                             ('line', cs.line_option_id), ('leader', cs.leader_option_id)) x(section, opt)
  JOIN gear_options o ON o.id = x.opt
  UNION ALL
  SELECT cs.id, o.kind, o.id, o.name, NULL, false
  FROM cs
  JOIN gear_setup_options so ON so.setup_id = cs.setup_id
  JOIN gear_options o ON o.id = so.option_id AND o.kind IN ('bead', 'flash')
  UNION ALL
  SELECT cs.id, k.kind, NULL, CASE k.kind WHEN 'bead' THEN 'No beads' ELSE 'No flash' END, NULL, true
  FROM cs
  CROSS JOIN (VALUES ('bead'), ('flash')) k(kind)
  WHERE NOT EXISTS (SELECT 1 FROM gear_setup_options so JOIN gear_options o ON o.id = so.option_id
                    WHERE so.setup_id = cs.setup_id AND o.kind = k.kind)
    -- ...and only when the setup was entered: a tip-up logged on before anyone set it up gets an
    -- empty first version (catch_gear_set), and "not entered" isn't "none"
    AND (cs.line_option_id IS NOT NULL OR cs.leader_option_id IS NOT NULL OR cs.hook_option_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM gear_setup_options so WHERE so.setup_id = cs.setup_id))
),
counted AS (
  SELECT section, key_id, is_none, min(name) AS name, min(owner) AS owner, count(*) AS fish
  FROM parts GROUP BY section, key_id, is_none
),
-- The biggest fish for each row: longest first; among equals (or no lengths), the earliest
biggest AS (
  SELECT DISTINCT ON (pt.section, pt.key_id, pt.is_none) pt.section, pt.key_id, pt.is_none,
         jsonb_build_object('catchNumber', cs.catch_number, 'length', cs.length_in_inches,
                            'species', cs.species, 'angler', cs.angler, 'caughtWhen', cs.caught_when) AS b
  FROM parts pt JOIN cs ON cs.id = pt.catch_id
  WHERE cs.length_in_inches IS NOT NULL
  ORDER BY pt.section, pt.key_id, pt.is_none, cs.length_in_inches DESC, cs.caught_when NULLS LAST, cs.id
),
ranked AS (
  SELECT c.section, jsonb_agg(jsonb_build_object(
           'id', c.key_id, 'name', c.name, 'owner', c.owner, 'none', c.is_none, 'fish', c.fish,
           'biggest', b.b)
         ORDER BY c.fish DESC, c.is_none, lower(c.name)) AS list
  FROM counted c
  LEFT JOIN biggest b ON b.section = c.section AND b.key_id IS NOT DISTINCT FROM c.key_id AND b.is_none = c.is_none
  GROUP BY c.section
)
SELECT jsonb_build_object(
  'fish',   (SELECT count(*) FROM cs),
  'tipUps', (SELECT count(DISTINCT gear_id) FROM cs),
  'waters', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) ORDER BY lower(w.name)), '[]'::jsonb)
             FROM bodies_of_water w WHERE w.id IN (SELECT body_of_water_id FROM on_gear)),
  'species', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY lower(s.name)), '[]'::jsonb)
              FROM fish_species s WHERE s.id IN (SELECT fish_species_id FROM on_gear)),
  'sections', (SELECT jsonb_build_object(
                 'tipUp',  coalesce((SELECT list FROM ranked WHERE section = 'tipUp'),  '[]'::jsonb),
                 'bait',   coalesce((SELECT list FROM ranked WHERE section = 'bait'),   '[]'::jsonb),
                 'hook',   coalesce((SELECT list FROM ranked WHERE section = 'hook'),   '[]'::jsonb),
                 'line',   coalesce((SELECT list FROM ranked WHERE section = 'line'),   '[]'::jsonb),
                 'leader', coalesce((SELECT list FROM ranked WHERE section = 'leader'), '[]'::jsonb),
                 'bead',   coalesce((SELECT list FROM ranked WHERE section = 'bead'),   '[]'::jsonb),
                 'flash',  coalesce((SELECT list FROM ranked WHERE section = 'flash'),  '[]'::jsonb)))
)
$$;

-- Same owner as the rest of the database (scripts/roles/gillbert_fullaccess.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_fullaccess') THEN
    ALTER FUNCTION gear_safe_date(text) OWNER TO gillbert_fullaccess;
    ALTER FUNCTION gear_stats_get(jsonb) OWNER TO gillbert_fullaccess;
  END IF;
END $$;

COMMIT;

-- Check: it answers (fish and tip-ups counted, the sections there)
SELECT r->'fish' AS fish, r->'tipUps' AS tip_ups, jsonb_object_keys(r->'sections') AS sections
FROM (SELECT gear_stats_get() AS r) x;
