-- Gear (stage 2): link a catch to the tip-up it was caught on, and its bait.
-- Plan: docs/plans/gear-tip-ups.md. Run as the database admin after 01–03, then
-- scripts/views/vw_catch_details.sql (which shows the link on the catch pages), then 05 to check.
-- Safe to re-run (CREATE OR REPLACE).
--
-- Save Catch calls this right after it saves the catch, and only when the request carried
-- the gear fields (the Log a Catch and Edit Catch forms always do; Catch Chat doesn't yet, so
-- a chat-logged catch keeps whatever it had).
--
-- It never refuses: the catch is already saved by then, so a bad tip-up id just leaves
-- "Caught on" empty instead of failing the save. The forms only offer real tip-ups.

CREATE OR REPLACE FUNCTION catch_gear_set(p_catch_id int, p_gear_id int, p_bait text, p_by int)
RETURNS SETOF catches
LANGUAGE plpgsql AS $$
DECLARE
  v_when  timestamptz;
  v_setup int;
  v_bait  int;
BEGIN
  SELECT caught_when INTO v_when FROM catches WHERE id = p_catch_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_gear_id IS NOT NULL AND EXISTS (SELECT 1 FROM gear WHERE id = p_gear_id) THEN
    -- The version in use when the fish was caught: the newest one that took effect at or
    -- before caught_when (a catch logged that night still gets the morning's hook).
    -- Caught before the first version was entered? Use the first version.
    SELECT id INTO v_setup FROM gear_setups
    WHERE gear_id = p_gear_id AND created_at <= coalesce(v_when, now())
    ORDER BY version_no DESC LIMIT 1;
    IF v_setup IS NULL THEN
      SELECT id INTO v_setup FROM gear_setups
      WHERE gear_id = p_gear_id ORDER BY version_no LIMIT 1;
    END IF;
    -- A tip-up nobody has set up yet: give it an empty first version, so the catch can
    -- point at it. Its next setup change then adds v2, and this catch stays "setup unknown".
    IF v_setup IS NULL THEN
      INSERT INTO gear_setups (gear_id, version_no, created_by_angler_id, updated_by_angler_id)
      VALUES (p_gear_id, 1, p_by, p_by)
      ON CONFLICT (gear_id, version_no) DO NOTHING
      RETURNING id INTO v_setup;
      IF v_setup IS NULL THEN
        SELECT id INTO v_setup FROM gear_setups WHERE gear_id = p_gear_id AND version_no = 1;
      END IF;
    END IF;
  END IF;

  -- Bait is a type-ahead tag like the setup parts: anything new becomes a choice for everyone
  v_bait := gear_option_find_or_add('bait', left(gear_clean(p_bait), 100), p_by);

  RETURN QUERY
  UPDATE catches SET gear_setup_id = v_setup, bait_option_id = v_bait
  WHERE id = p_catch_id
  RETURNING *;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_fullaccess') THEN
    ALTER FUNCTION catch_gear_set(int, int, text, int) OWNER TO gillbert_fullaccess;
  END IF;
END $$;
