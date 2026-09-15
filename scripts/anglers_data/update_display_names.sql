-- One-time: update angler names to a friendlier/more disambiguated display
-- format (e.g. "Kurt" -> "Kurt W"), and backfill each angler's bare first
-- name into aliases so Catch Chat's exact-match Lookup Angler node still
-- recognizes it once the stored name is no longer just the first name.
-- Value-only change -- no schema/view/n8n change needed (every consumer
-- reads anglers.name live/dynamically; see project_angler_management memory
-- for the full blast-radius analysis).
--
-- Fill in new_name for each row below (current name/aliases shown in the
-- comment for reference, pulled live 2026-09-05), then run. Safe to re-run:
-- the alias backfill only appends first_name_alias if it's not already
-- present, and re-running with the same new_name values is a no-op.
--
-- Rows for id 10 (ZZZ_TEST_DELETE_ME) and id 11 (JOseph) intentionally
-- excluded -- both were throwaway test rows, deleted directly rather than
-- renamed.

CREATE TEMP TABLE angler_name_updates (
    id integer PRIMARY KEY,
    new_name varchar(255) NOT NULL,
    first_name_alias varchar(255) NOT NULL
);

INSERT INTO angler_name_updates (id, new_name, first_name_alias) VALUES
    (1,  'Kurt W', 'Kurt'),    -- currently: Kurt   | aliases: {Wondra}
    (2,  'Brian K', 'Brian'),   -- currently: Brian  | aliases: {Kaufman}
    (3,  'Korey S', 'Korey'),   -- currently: Korey  | aliases: {}
    (4,  'Corey N', 'Corey'),   -- currently: Corey  | aliases: {Nugent, Nug}
    (5,  'Matt E', 'Matt'),    -- currently: Matt   | aliases: {Ebel}
    (6,  'Kent S', 'Kent'),    -- currently: Kent   | aliases: {}
    (7,  'Lori K', 'Lori'),    -- currently: Lori   | aliases: {}
    (8,  'Layton K', 'Layton'),  -- currently: Layton | aliases: {}
    (9,  'Brett S', 'Brett');   -- currently: Brett  | aliases: {}

-- ── Preview: what would change ──────────────────────────────────────────
SELECT
    a.id,
    a.name AS current_name,
    u.new_name,
    a.aliases AS current_aliases,
    CASE
        WHEN u.first_name_alias = ANY(COALESCE(a.aliases, ARRAY[]::varchar(255)[]))
            THEN a.aliases
        ELSE array_prepend(u.first_name_alias, COALESCE(a.aliases, ARRAY[]::varchar(255)[]))
    END AS new_aliases
FROM anglers a
JOIN angler_name_updates u ON u.id = a.id
ORDER BY a.id;

-- ── Fix: apply it ────────────────────────────────────────────────────────
UPDATE anglers a
SET name = u.new_name,
    aliases = CASE
        WHEN u.first_name_alias = ANY(COALESCE(a.aliases, ARRAY[]::varchar(255)[]))
            THEN a.aliases
        ELSE array_prepend(u.first_name_alias, COALESCE(a.aliases, ARRAY[]::varchar(255)[]))
    END,
    updated_at = now()
FROM angler_name_updates u
WHERE a.id = u.id;

DROP TABLE angler_name_updates;
