-- Gear stage 6: the admin's tag clean-up (docs/plans/gear-tip-ups.md, "Stage 6").
-- Tags are the shared type-ahead values: line, leader, hook, bead, flash, bait, model, color.
-- Safe to re-run (CREATE OR REPLACE). Run after 01-04, as the database admin (uses 02's gear_int).
--
--   gear/tags       SELECT gear_tags_get()           every tag with how much it's used
--   gear/tag-save   SELECT gear_tag_save($1::jsonb)  rename, hide, show, merge or delete one
--
-- Like the other gear saves: one call, one transaction, and a bad request answers
-- {"success": false, "message": "..."} instead of raising. The admin gate is the page's, like
-- the other admin pages.

-- Every tag, with the tip-ups that use it (in any setup version, or as model / color) and the
-- catches that name it as bait
BEGIN;

CREATE OR REPLACE FUNCTION gear_tags_get() RETURNS jsonb
LANGUAGE sql STABLE AS $$
WITH used AS (
  SELECT line_option_id AS option_id, gear_id FROM gear_setups WHERE line_option_id IS NOT NULL
  UNION ALL SELECT leader_option_id, gear_id FROM gear_setups WHERE leader_option_id IS NOT NULL
  UNION ALL SELECT hook_option_id, gear_id FROM gear_setups WHERE hook_option_id IS NOT NULL
  UNION ALL SELECT so.option_id, s.gear_id FROM gear_setup_options so JOIN gear_setups s ON s.id = so.setup_id
  UNION ALL SELECT model_option_id, id FROM gear WHERE model_option_id IS NOT NULL
  UNION ALL SELECT color_option_id, id FROM gear WHERE color_option_id IS NOT NULL
),
tips AS (SELECT option_id, count(DISTINCT gear_id) AS n FROM used GROUP BY option_id),
baits AS (SELECT bait_option_id AS option_id, count(*) AS n FROM catches
          WHERE bait_option_id IS NOT NULL GROUP BY bait_option_id)
SELECT coalesce(jsonb_agg(jsonb_build_object(
         'id', o.id, 'kind', o.kind, 'name', o.name, 'status', o.status,
         'tipUps', coalesce(t.n, 0), 'catches', coalesce(b.n, 0), 'createdAt', o.created_at)
       ORDER BY o.kind, lower(o.name)), '[]'::jsonb)
FROM gear_options o
LEFT JOIN tips t ON t.option_id = o.id
LEFT JOIN baits b ON b.option_id = o.id
$$;

-- Body: { id, action, name (rename), intoId (merge), byAnglerId }
--   rename  fixes the spelling; refused when the kind already has that name (merge instead)
--   hide    off the type-ahead lists; everything already using it keeps it
--   show    back on the lists
--   merge   everything using this tag uses intoId instead (same kind), then this one goes
--   delete  only a tag nothing uses
-- The tip-ups' history keeps the old text, so it still reads as it happened.
CREATE OR REPLACE FUNCTION gear_tag_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_id     int  := gear_int(p->>'id');
  v_action text := p->>'action';
  v_name   text := gear_clean(p->>'name');
  v_into   int  := gear_int(p->>'intoId');
  v_tag    gear_options%ROWTYPE;
  v_target gear_options%ROWTYPE;
  v_taken  text;
BEGIN
  SELECT * INTO v_tag FROM gear_options WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM gear_fail('That tag isn''t there any more. It may have been merged or deleted.');
  END IF;

  IF v_action = 'rename' THEN
    IF v_name IS NULL THEN PERFORM gear_fail('Give it a name.'); END IF;
    IF length(v_name) > 100 THEN PERFORM gear_fail('100 characters at most.'); END IF;
    SELECT name INTO v_taken FROM gear_options
    WHERE kind = v_tag.kind AND name_key = lower(v_name) AND id <> v_id;
    IF v_taken IS NOT NULL THEN
      PERFORM gear_fail(format('"%s" is already there. Merge into it instead.', v_taken));
    END IF;
    UPDATE gear_options SET name = v_name WHERE id = v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id);

  ELSIF v_action IN ('hide', 'show') THEN
    UPDATE gear_options SET status = CASE WHEN v_action = 'hide' THEN 'Hidden' ELSE 'Active' END WHERE id = v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id);

  ELSIF v_action = 'merge' THEN
    SELECT * INTO v_target FROM gear_options WHERE id = v_into FOR UPDATE;
    IF NOT FOUND OR v_into = v_id THEN PERFORM gear_fail('Pick another tag to merge into.'); END IF;
    IF v_target.kind <> v_tag.kind THEN PERFORM gear_fail('Tags can only be merged into the same kind.'); END IF;
    UPDATE gear_setups SET line_option_id   = v_into WHERE line_option_id   = v_id;
    UPDATE gear_setups SET leader_option_id = v_into WHERE leader_option_id = v_id;
    UPDATE gear_setups SET hook_option_id   = v_into WHERE hook_option_id   = v_id;
    INSERT INTO gear_setup_options (setup_id, option_id)          -- a setup that had both keeps one
      SELECT setup_id, v_into FROM gear_setup_options WHERE option_id = v_id
      ON CONFLICT DO NOTHING;
    DELETE FROM gear_setup_options WHERE option_id = v_id;
    UPDATE gear SET model_option_id = v_into WHERE model_option_id = v_id;
    UPDATE gear SET color_option_id = v_into WHERE color_option_id = v_id;
    UPDATE catches SET bait_option_id = v_into WHERE bait_option_id = v_id;
    DELETE FROM gear_options WHERE id = v_id;
    RETURN jsonb_build_object('success', true, 'id', v_into);

  ELSIF v_action = 'delete' THEN
    DELETE FROM gear_options WHERE id = v_id;   -- the foreign keys refuse it while anything uses it
    RETURN jsonb_build_object('success', true);

  ELSE
    PERFORM gear_fail('Unknown change.');
  END IF;
  RETURN NULL;  -- not reached
EXCEPTION
  WHEN SQLSTATE 'GR001' THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('success', false, 'message', 'It''s still in use. Merge it into another tag, or hide it.');
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'message', 'That name is already there. Merge into it instead.');
END $$;

-- Same owner as the rest of the database (scripts/roles/gillbert_fullaccess.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_fullaccess') THEN
    ALTER FUNCTION gear_tags_get() OWNER TO gillbert_fullaccess;
    ALTER FUNCTION gear_tag_save(jsonb) OWNER TO gillbert_fullaccess;
  END IF;
END $$;

COMMIT;

-- Check: both functions answer (the list, and a refused change on a tag that isn't there)
SELECT jsonb_array_length(gear_tags_get()) AS tags,
       gear_tag_save('{"id": -1, "action": "hide"}') ->> 'message' AS refused;
