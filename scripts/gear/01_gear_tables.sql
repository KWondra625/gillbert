-- Gear (stage 1): tip-ups, their setup versions, the shared type-ahead tags, and each tip-up's history.
-- Plan: docs/plans/gear-tip-ups.md. Safe to re-run (IF NOT EXISTS / ON CONFLICT throughout).
--
-- Run as the database admin, in the Gillbert database, then run 02_gear_functions.sql.
-- New objects are handed to gillbert_fullaccess at the end, like everything else in the database.
--
-- catches gets two nullable columns (gear_setup_id, bait_option_id). Nothing reads or writes
-- them until stage 2; existing catches keep null. They're added now so the setup-save rule
-- ("add a new version once a catch uses the current one") is final from day one.
-- vw_catch_details lists its columns by name, so it doesn't change.
BEGIN;

-- The shared tags: what you'd find at the bait and tackle store, plus tip-up model and color.
-- Anyone adds a tag by typing it; only admins merge or hide them (stage 6).
CREATE TABLE IF NOT EXISTS gear_options (
    id SERIAL PRIMARY KEY,
    kind varchar(20) NOT NULL
        CHECK (kind IN ('line', 'leader', 'hook', 'bead', 'flash', 'bait', 'model', 'color')),
    name varchar(100) NOT NULL CHECK (btrim(name) <> ''),
    -- Lower case, spaces trimmed and squeezed: "Dacron  30 LB" and "dacron 30 lb" are one tag
    name_key text GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED,
    status varchar(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Hidden')),
    created_by_angler_id INT REFERENCES anglers(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT gear_options_kind_name_key UNIQUE (kind, name_key)
);

-- One row per tip-up (rods later). The name is the crew's choice; the owner is stored on its own.
CREATE TABLE IF NOT EXISTS gear (
    id SERIAL PRIMARY KEY,
    gear_type varchar(20) NOT NULL DEFAULT 'tip_up' CHECK (gear_type IN ('tip_up', 'rod')),
    display_name varchar(50) NOT NULL CHECK (btrim(display_name) <> ''),
    -- Unique across all gear, ignoring capitals and extra spaces
    name_key text GENERATED ALWAYS AS (lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g'))) STORED,
    owner_angler_id INT NOT NULL REFERENCES anglers(id),
    model_option_id INT REFERENCES gear_options(id),
    color_option_id INT REFERENCES gear_options(id),
    status varchar(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Retired')),
    retired_note text,
    notes text CHECK (length(notes) <= 1000),   -- free text, e.g. "Trigger sticks in the cold"
    created_by_angler_id INT REFERENCES anglers(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_by_angler_id INT REFERENCES anglers(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT gear_name_key UNIQUE (name_key)
);

-- One row per setup version; catches point here (stage 2). A version is edited in place
-- until a catch uses it; after that, the next change adds a new version.
-- created_at = when this version took effect (a late-logged catch picks its version by caught_when).
CREATE TABLE IF NOT EXISTS gear_setups (
    id SERIAL PRIMARY KEY,
    gear_id INT NOT NULL REFERENCES gear(id) ON DELETE CASCADE,
    version_no INT NOT NULL CHECK (version_no > 0),
    line_option_id INT REFERENCES gear_options(id),
    leader_option_id INT REFERENCES gear_options(id),
    hook_option_id INT REFERENCES gear_options(id),
    photo_blob_path varchar(255),      -- stage 3
    photo_read_url varchar(255),       -- stage 3
    photo_thumbnail_url varchar(255),  -- stage 3
    photo_uploaded_at TIMESTAMPTZ,     -- stage 3
    created_by_angler_id INT REFERENCES anglers(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_by_angler_id INT REFERENCES anglers(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT gear_setups_gear_version UNIQUE (gear_id, version_no)
);

-- Beads and flash on a version: zero or more of each
CREATE TABLE IF NOT EXISTS gear_setup_options (
    setup_id INT NOT NULL REFERENCES gear_setups(id) ON DELETE CASCADE,
    option_id INT NOT NULL REFERENCES gear_options(id),
    PRIMARY KEY (setup_id, option_id)
);

-- The tip-up's history: one row per change to the tip-up or its setup. Values are kept as
-- text, so the history still reads right after a tag is renamed or merged.
CREATE TABLE IF NOT EXISTS gear_history (
    id SERIAL PRIMARY KEY,
    gear_id INT NOT NULL REFERENCES gear(id) ON DELETE CASCADE,
    event_type varchar(30) NOT NULL
        CHECK (event_type IN ('created', 'setup', 'rename', 'owner', 'model', 'color', 'notes', 'retire', 'unretire')),
    field varchar(30),
    old_value text,
    new_value text,
    by_angler_id INT REFERENCES anglers(id),
    at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS gear_history_gear_id ON gear_history (gear_id, at);
CREATE INDEX IF NOT EXISTS gear_setups_gear_id ON gear_setups (gear_id, version_no);

-- Stage 2 columns on catches (unused until then). A catch's setup can't be deleted, so a
-- tip-up that caught something can only be retired.
ALTER TABLE catches ADD COLUMN IF NOT EXISTS gear_setup_id INT REFERENCES gear_setups(id);
ALTER TABLE catches ADD COLUMN IF NOT EXISTS bait_option_id INT REFERENCES gear_options(id);
CREATE INDEX IF NOT EXISTS catches_gear_setup_id ON catches (gear_setup_id) WHERE gear_setup_id IS NOT NULL;

-- Bait starter list (Kurt, 2026-11-18). Anything else gets typed and becomes a choice.
INSERT INTO gear_options (kind, name)
VALUES ('bait', 'Shiner (small)'), ('bait', 'Shiner (medium)'), ('bait', 'Shiner (large)'),
       ('bait', 'Sucker (small)'), ('bait', 'Sucker (medium)'), ('bait', 'Sucker (large)'),
       ('bait', 'Not sure')
ON CONFLICT (kind, name_key) DO NOTHING;

-- Line starter list (Kurt, 2026-11-26): the crew mostly runs Sufix metered tip-up braid
INSERT INTO gear_options (kind, name)
VALUES ('line', 'Sufix Metered Tip-Up Ice Braid 15 lb'), ('line', 'Sufix Metered Tip-Up Ice Braid 20 lb')
ON CONFLICT (kind, name_key) DO NOTHING;

-- Same owner as the rest of the database (scripts/roles/gillbert_fullaccess.sql)
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gillbert_fullaccess') THEN
    FOREACH t IN ARRAY ARRAY['gear_options', 'gear', 'gear_setups', 'gear_setup_options', 'gear_history'] LOOP
      EXECUTE format('ALTER TABLE %I OWNER TO gillbert_fullaccess', t);
    END LOOP;
  END IF;
END $$;

COMMIT;

-- Check: 5 tables, 2 new catches columns, 7 baits, 2 lines
SELECT (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name IN ('gear_options', 'gear', 'gear_setups', 'gear_setup_options', 'gear_history')) AS gear_tables,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'catches'
           AND column_name IN ('gear_setup_id', 'bait_option_id')) AS catches_columns,
       (SELECT count(*) FROM gear_options WHERE kind = 'bait') AS baits,
       (SELECT count(*) FROM gear_options WHERE kind = 'line') AS lines;
