-- Gear (stage 1): the database functions behind the three gear endpoints. Safe to re-run
-- (CREATE OR REPLACE). Run after 01_gear_tables.sql, as the database admin. Since stage 3 it
-- needs 11_gear_photos.sql first (the photo_viewing_url column).
--
-- Each endpoint is a single call, so each save is one transaction that either fully happens or
-- doesn't. The n8n workflows only check the API key and pass the request body as a bound
-- parameter ($1); request values never become SQL text.
--
--   gear/get          SELECT gear_get(NULLIF($1, '')::int)   list (+ one tip-up's history when an id is given)
--   gear/save         SELECT gear_save($1::jsonb)            add, rename, owner, model, color, retire, delete
--   gear/setup-save   SELECT gear_setup_save($1::jsonb)      change a tip-up's setup
--
-- Saves answer {"success": true, ...} or {"success": false, "message": "..."} with a message
-- the page can show as is. They never raise for a bad request.

-- Trims, squeezes inner spaces, and turns blank into NULL
CREATE OR REPLACE FUNCTION gear_clean(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '')
$$;

-- Stops a save with a message for the person saving (caught by the save functions below)
CREATE OR REPLACE FUNCTION gear_fail(p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'GR001', MESSAGE = p_message;
END $$;

-- The id of a tag, adding it if it's new. Blank = NULL (nothing chosen).
CREATE OR REPLACE FUNCTION gear_option_find_or_add(p_kind text, p_name text, p_by int) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  v_name text := gear_clean(p_name);
  v_id int;
BEGIN
  IF v_name IS NULL THEN RETURN NULL; END IF;
  IF length(v_name) > 100 THEN
    PERFORM gear_fail(format('"%s…" is too long: 100 characters at most.', left(v_name, 30)));
  END IF;
  SELECT id INTO v_id FROM gear_options WHERE kind = p_kind AND name_key = lower(v_name);
  IF v_id IS NULL THEN
    INSERT INTO gear_options (kind, name, created_by_angler_id) VALUES (p_kind, v_name, p_by)
    ON CONFLICT (kind, name_key) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN  -- someone else added it a moment ago
      SELECT id INTO v_id FROM gear_options WHERE kind = p_kind AND name_key = lower(v_name);
    END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION gear_option_name(p_id int) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT name FROM gear_options WHERE id = p_id
$$;

-- "Glow, Red" for a list of tag ids (NULL when empty), for the history
CREATE OR REPLACE FUNCTION gear_option_names(p_ids int[]) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(name, ', ' ORDER BY lower(name)) FROM gear_options WHERE id = ANY(p_ids)
$$;

-- A JSON array from the request, or an empty one if it isn't an array
CREATE OR REPLACE FUNCTION gear_json_array(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'array' THEN p ELSE '[]'::jsonb END
$$;

-- ── gear/get ───────────────────────────────────────────────────────────────────────────────
-- { tipUps: [...], options: { line: [...], ... }, history: [...] (only with an id) }
CREATE OR REPLACE FUNCTION gear_get(p_id int DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE AS $$
WITH cur AS (            -- each tip-up's current (newest) version
  SELECT DISTINCT ON (s.gear_id) s.*
  FROM gear_setups s
  ORDER BY s.gear_id, s.version_no DESC
),
parts AS (               -- beads and flash per version
  SELECT so.setup_id, o.kind, jsonb_agg(o.name ORDER BY lower(o.name)) AS names
  FROM gear_setup_options so
  JOIN gear_options o ON o.id = so.option_id
  GROUP BY so.setup_id, o.kind
),
tip AS (
  SELECT jsonb_build_object(
    'id', g.id,
    'gearType', g.gear_type,
    'name', g.display_name,
    'ownerAnglerId', g.owner_angler_id,
    'ownerName', a.display_name,
    'model', om.name,
    'color', oc.name,
    'status', g.status,
    'retiredNote', g.retired_note,
    'notes', g.notes,
    'createdAt', g.created_at,
    'updatedAt', g.updated_at,
    'catchCount', (SELECT count(*) FROM catches c JOIN gear_setups s ON s.id = c.gear_setup_id
                    WHERE s.gear_id = g.id),
    'setup', CASE WHEN cur.id IS NULL THEN NULL ELSE jsonb_build_object(
      'versionNo', cur.version_no,
      'line', ol.name,
      'leader', ole.name,
      'hook', oh.name,
      'beads', coalesce(pb.names, '[]'::jsonb),
      'flash', coalesce(pf.names, '[]'::jsonb),
      -- Stage 3: the current version's photo (its 3 files), or null
      'photo', CASE WHEN cur.photo_blob_path IS NULL THEN NULL ELSE jsonb_build_object(
                 'thumbnailUrl', cur.photo_thumbnail_url, 'viewingUrl', cur.photo_viewing_url,
                 'originalUrl', cur.photo_read_url) END,
      'since', cur.created_at) END
  ) AS j
  FROM gear g
  JOIN anglers a ON a.id = g.owner_angler_id
  LEFT JOIN gear_options om ON om.id = g.model_option_id
  LEFT JOIN gear_options oc ON oc.id = g.color_option_id
  LEFT JOIN cur ON cur.gear_id = g.id
  LEFT JOIN gear_options ol  ON ol.id  = cur.line_option_id
  LEFT JOIN gear_options ole ON ole.id = cur.leader_option_id
  LEFT JOIN gear_options oh  ON oh.id  = cur.hook_option_id
  LEFT JOIN parts pb ON pb.setup_id = cur.id AND pb.kind = 'bead'
  LEFT JOIN parts pf ON pf.setup_id = cur.id AND pf.kind = 'flash'
  WHERE p_id IS NULL OR g.id = p_id
)
SELECT jsonb_build_object(
  'tipUps', coalesce((SELECT jsonb_agg(j ORDER BY lower(j->>'name')) FROM tip), '[]'::jsonb),
  'options', coalesce((SELECT jsonb_object_agg(kind, names) FROM (
                SELECT kind, jsonb_agg(name ORDER BY lower(name)) AS names
                FROM gear_options WHERE status = 'Active' GROUP BY kind) k), '{}'::jsonb),
  'history', CASE WHEN p_id IS NULL THEN NULL ELSE coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                         'id', h.id, 'at', h.at, 'byName', b.display_name, 'eventType', h.event_type,
                         'field', h.field, 'oldValue', h.old_value, 'newValue', h.new_value)
                       ORDER BY h.at DESC, h.id DESC)
                FROM gear_history h LEFT JOIN anglers b ON b.id = h.by_angler_id
                WHERE h.gear_id = p_id), '[]'::jsonb) END
)
$$;

-- ── gear/save ──────────────────────────────────────────────────────────────────────────────
-- Body: { id (none = add), name, ownerAnglerId, model, color, notes, status, retiredNote, byAnglerId }
--   or  { id, delete: true, byAnglerId }  (only while no catch uses the tip-up; the answer's
--       removePaths = its setup photos' files, for the workflow to delete)
CREATE OR REPLACE FUNCTION gear_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_id     int  := NULLIF(p->>'id', '')::int;
  v_by     int  := NULLIF(p->>'byAnglerId', '')::int;
  v_name   text := gear_clean(p->>'name');
  v_owner  int  := NULLIF(p->>'ownerAnglerId', '')::int;
  v_status text := coalesce(NULLIF(p->>'status', ''), 'Active');
  v_note   text := NULLIF(btrim(coalesce(p->>'retiredNote', '')), '');
  v_notes  text := NULLIF(btrim(coalesce(p->>'notes', '')), '');
  v_model  int;
  v_color  int;
  v_taken  text;
  v_old    gear%ROWTYPE;
  v_files  jsonb;
BEGIN
  IF v_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM anglers WHERE id = v_by) THEN
    v_by := NULL;  -- an unknown "who" is recorded as unknown, not refused
  END IF;

  -- Delete: only a tip-up no catch points at (the catches foreign key also refuses it)
  IF coalesce((p->>'delete')::boolean, false) THEN
    SELECT * INTO v_old FROM gear WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM gear_fail('That tip-up no longer exists.'); END IF;
    IF EXISTS (SELECT 1 FROM catches c JOIN gear_setups s ON s.id = c.gear_setup_id WHERE s.gear_id = v_id) THEN
      PERFORM gear_fail(format('%s has caught fish, so it can only be retired, not deleted.', v_old.display_name));
    END IF;
    -- Its setup photos' files (stage 3), for the workflow to delete once the rows are gone
    SELECT coalesce(jsonb_agg(f), '[]'::jsonb) INTO v_files
      FROM (SELECT DISTINCT photo_blob_path FROM gear_setups WHERE gear_id = v_id AND photo_blob_path IS NOT NULL) ph,
           jsonb_array_elements_text(gear_photo_paths(ph.photo_blob_path)) f;
    DELETE FROM gear WHERE id = v_id;  -- its versions, beads/flash and history go with it
    RETURN jsonb_build_object('success', true, 'id', v_id, 'deleted', true, 'removePaths', v_files);
  END IF;

  IF v_name IS NULL THEN PERFORM gear_fail('Please enter a name.'); END IF;
  IF length(v_name) > 50 THEN PERFORM gear_fail('Names can be 50 characters at most.'); END IF;
  IF v_owner IS NULL OR NOT EXISTS (SELECT 1 FROM anglers WHERE id = v_owner) THEN
    PERFORM gear_fail('Please choose an owner.');
  END IF;
  IF length(v_notes) > 1000 THEN PERFORM gear_fail('Notes can be 1,000 characters at most.'); END IF;
  IF v_status NOT IN ('Active', 'Retired') THEN PERFORM gear_fail('Status must be Active or Retired.'); END IF;
  IF v_status = 'Active' THEN v_note := NULL; END IF;

  SELECT format('"%s" is already taken (%s''s). Names must be unique.', g.display_name, a.display_name)
    INTO v_taken
    FROM gear g JOIN anglers a ON a.id = g.owner_angler_id
   WHERE g.name_key = lower(v_name) AND g.id IS DISTINCT FROM v_id;
  IF v_taken IS NOT NULL THEN PERFORM gear_fail(v_taken); END IF;

  v_model := gear_option_find_or_add('model', p->>'model', v_by);
  v_color := gear_option_find_or_add('color', p->>'color', v_by);

  IF v_id IS NULL THEN
    INSERT INTO gear (display_name, owner_angler_id, model_option_id, color_option_id, notes, status, retired_note,
                      created_by_angler_id, updated_by_angler_id)
    VALUES (v_name, v_owner, v_model, v_color, v_notes, v_status, v_note, v_by, v_by)
    RETURNING id INTO v_id;
    INSERT INTO gear_history (gear_id, event_type, new_value, by_angler_id) VALUES (v_id, 'created', v_name, v_by);
    RETURN jsonb_build_object('success', true, 'id', v_id, 'created', true);
  END IF;

  SELECT * INTO v_old FROM gear WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM gear_fail('That tip-up no longer exists.'); END IF;

  UPDATE gear
     SET display_name = v_name, owner_angler_id = v_owner, model_option_id = v_model,
         color_option_id = v_color, notes = v_notes, status = v_status, retired_note = v_note,
         updated_by_angler_id = v_by, updated_at = now()
   WHERE id = v_id;

  IF v_old.display_name IS DISTINCT FROM v_name THEN
    INSERT INTO gear_history (gear_id, event_type, field, old_value, new_value, by_angler_id)
    VALUES (v_id, 'rename', 'name', v_old.display_name, v_name, v_by);
  END IF;
  IF v_old.owner_angler_id IS DISTINCT FROM v_owner THEN
    INSERT INTO gear_history (gear_id, event_type, field, old_value, new_value, by_angler_id)
    VALUES (v_id, 'owner', 'owner',
            (SELECT display_name FROM anglers WHERE id = v_old.owner_angler_id),
            (SELECT display_name FROM anglers WHERE id = v_owner), v_by);
  END IF;
  IF v_old.model_option_id IS DISTINCT FROM v_model THEN
    INSERT INTO gear_history (gear_id, event_type, field, old_value, new_value, by_angler_id)
    VALUES (v_id, 'model', 'model', gear_option_name(v_old.model_option_id), gear_option_name(v_model), v_by);
  END IF;
  IF v_old.color_option_id IS DISTINCT FROM v_color THEN
    INSERT INTO gear_history (gear_id, event_type, field, old_value, new_value, by_angler_id)
    VALUES (v_id, 'color', 'color', gear_option_name(v_old.color_option_id), gear_option_name(v_color), v_by);
  END IF;
  IF v_old.notes IS DISTINCT FROM v_notes THEN
    INSERT INTO gear_history (gear_id, event_type, field, old_value, new_value, by_angler_id)
    VALUES (v_id, 'notes', 'notes', v_old.notes, v_notes, v_by);
  END IF;
  IF v_old.status <> v_status THEN
    INSERT INTO gear_history (gear_id, event_type, field, old_value, new_value, by_angler_id)
    VALUES (v_id, CASE WHEN v_status = 'Retired' THEN 'retire' ELSE 'unretire' END, 'status',
            v_old.retired_note, v_note, v_by);   -- retiring: new_value = why; coming back: old_value = why it was
  ELSIF v_status = 'Retired' AND v_old.retired_note IS DISTINCT FROM v_note THEN
    INSERT INTO gear_history (gear_id, event_type, field, old_value, new_value, by_angler_id)
    VALUES (v_id, 'retire', 'note', v_old.retired_note, v_note, v_by);
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION
  WHEN SQLSTATE 'GR001' THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
  WHEN unique_violation THEN  -- two people saving the same new name at the same moment
    RETURN jsonb_build_object('success', false, 'message', 'That name is already taken. Names must be unique.');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('success', false, 'message', 'That tip-up has caught fish, so it can only be retired, not deleted.');
END $$;

-- ── gear/setup-save ────────────────────────────────────────────────────────────────────────
-- Body: { gearId, line, leader, hook, beads: [...], flash: [...], byAnglerId }
-- Values are tag names; new ones are added. The current version is updated in place while
-- no catch uses it; once one does, a new version is added and the old one is left as it was.
CREATE OR REPLACE FUNCTION gear_setup_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_gear   int := NULLIF(p->>'gearId', '')::int;
  v_by     int := NULLIF(p->>'byAnglerId', '')::int;
  g        gear%ROWTYPE;
  cur      gear_setups%ROWTYPE;
  v_line   int;
  v_leader int;
  v_hook   int;
  v_beads  int[];
  v_flash  int[];
  old_beads int[] := '{}';
  old_flash int[] := '{}';
  v_setup  int;
  v_version int;
  v_new    boolean;
BEGIN
  IF v_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM anglers WHERE id = v_by) THEN
    v_by := NULL;
  END IF;

  -- Locking the tip-up makes two people saving at once take turns
  SELECT * INTO g FROM gear WHERE id = v_gear FOR UPDATE;
  IF NOT FOUND THEN PERFORM gear_fail('That tip-up no longer exists.'); END IF;
  IF g.status = 'Retired' THEN
    PERFORM gear_fail(format('%s is retired. Bring it back before changing its setup.', g.display_name));
  END IF;

  v_line   := gear_option_find_or_add('line',   p->>'line',   v_by);
  v_leader := gear_option_find_or_add('leader', p->>'leader', v_by);
  v_hook   := gear_option_find_or_add('hook',   p->>'hook',   v_by);
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_beads
    FROM (SELECT gear_option_find_or_add('bead', e, v_by) AS x
            FROM jsonb_array_elements_text(gear_json_array(p->'beads')) e) s
   WHERE x IS NOT NULL;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_flash
    FROM (SELECT gear_option_find_or_add('flash', e, v_by) AS x
            FROM jsonb_array_elements_text(gear_json_array(p->'flash')) e) s
   WHERE x IS NOT NULL;

  SELECT * INTO cur FROM gear_setups WHERE gear_id = v_gear ORDER BY version_no DESC LIMIT 1;
  IF cur.id IS NOT NULL THEN
    SELECT coalesce(array_agg(so.option_id ORDER BY so.option_id) FILTER (WHERE o.kind = 'bead'), '{}'),
           coalesce(array_agg(so.option_id ORDER BY so.option_id) FILTER (WHERE o.kind = 'flash'), '{}')
      INTO old_beads, old_flash
      FROM gear_setup_options so JOIN gear_options o ON o.id = so.option_id
     WHERE so.setup_id = cur.id;

    IF cur.line_option_id IS NOT DISTINCT FROM v_line
       AND cur.leader_option_id IS NOT DISTINCT FROM v_leader
       AND cur.hook_option_id IS NOT DISTINCT FROM v_hook
       AND old_beads = v_beads AND old_flash = v_flash THEN
      RETURN jsonb_build_object('success', true, 'changed', false, 'versionNo', cur.version_no);
    END IF;
  END IF;

  -- The history, part by part (a first setup reads as "none → ...")
  INSERT INTO gear_history (gear_id, event_type, field, old_value, new_value, by_angler_id)
  SELECT v_gear, 'setup', f.field, f.old_value, f.new_value, v_by
    FROM (VALUES
      (1, 'line',   gear_option_name(cur.line_option_id),   gear_option_name(v_line)),
      (2, 'leader', gear_option_name(cur.leader_option_id), gear_option_name(v_leader)),
      (3, 'hook',   gear_option_name(cur.hook_option_id),   gear_option_name(v_hook)),
      (4, 'beads',  gear_option_names(old_beads),           gear_option_names(v_beads)),
      (5, 'flash',  gear_option_names(old_flash),           gear_option_names(v_flash))
    ) AS f(n, field, old_value, new_value)
   WHERE f.old_value IS DISTINCT FROM f.new_value
   ORDER BY f.n;

  v_new := cur.id IS NULL
        OR EXISTS (SELECT 1 FROM catches WHERE gear_setup_id = cur.id);

  IF v_new THEN
    v_version := coalesce(cur.version_no, 0) + 1;
    INSERT INTO gear_setups (gear_id, version_no, line_option_id, leader_option_id, hook_option_id,
                             photo_blob_path, photo_read_url, photo_thumbnail_url, photo_viewing_url,
                             photo_uploaded_at, created_by_angler_id, updated_by_angler_id)
    -- The photo carries over to the new version (stage 3) until someone replaces it
    VALUES (v_gear, v_version, v_line, v_leader, v_hook,
            cur.photo_blob_path, cur.photo_read_url, cur.photo_thumbnail_url, cur.photo_viewing_url,
            cur.photo_uploaded_at,
            v_by, v_by)
    RETURNING id INTO v_setup;
  ELSE
    v_setup := cur.id;
    v_version := cur.version_no;
    UPDATE gear_setups
       SET line_option_id = v_line, leader_option_id = v_leader, hook_option_id = v_hook,
           updated_by_angler_id = v_by, updated_at = now()
     WHERE id = v_setup;
    DELETE FROM gear_setup_options WHERE setup_id = v_setup;
  END IF;

  INSERT INTO gear_setup_options (setup_id, option_id)
  SELECT v_setup, unnest(v_beads || v_flash)
  ON CONFLICT DO NOTHING;

  UPDATE gear SET updated_by_angler_id = v_by, updated_at = now() WHERE id = v_gear;

  RETURN jsonb_build_object('success', true, 'changed', true, 'versionNo', v_version, 'newVersion', v_new);
EXCEPTION
  WHEN SQLSTATE 'GR001' THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END $$;

-- Same owner as the rest of the database (scripts/roles/gillbert_fullaccess.sql)
DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_fullaccess') THEN
    FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = current_schema() AND p.proname LIKE 'gear\_%' LOOP
      EXECUTE format('ALTER ROUTINE %s OWNER TO gillbert_fullaccess', r.sig);
    END LOOP;
  END IF;
END $$;

-- Check: 9 functions, and the empty list answers
SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = current_schema() AND p.proname LIKE 'gear\_%') AS gear_functions,
       gear_get() -> 'tipUps' AS tip_ups;
