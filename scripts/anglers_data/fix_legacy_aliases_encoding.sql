-- One-time cleanup: anglers.aliases was populated from the original
-- Airtable import as a single-element text[] array whose one element is a
-- JSON-stringified array (e.g. the stored array is {'["Wondra"]'}, not the
-- real {Wondra}) -- confirmed 2026-09-05 via the anglers/get endpoint
-- response (same root cause as other legacy-import glitches, see the
-- "Copy Airtable Database to Postgres" workflow). This breaks alias
-- matching everywhere it's used (Catch Chat's Lookup Angler node does
-- unnest(aliases), which was comparing against the literal bracketed/
-- quoted string instead of the real name).
--
-- This unwraps that JSON string back into a real array, and additionally
-- splits any comma-separated value into separate aliases (e.g.
-- ["Nugent, Nug"] -> {Nugent, Nug} as two aliases), matching how the app's
-- own alias inputs are parsed everywhere else (create-angler.js,
-- edit-angler.js, create/edit-fish-species.js all split on comma). A JSON
-- `null` element (several rows have aliases = ["[null]"]) is dropped
-- entirely rather than kept as a literal alias.
--
-- Only touches rows that actually look corrupted: aliases has exactly one
-- element, and that element is bracket-wrapped like a JSON array. A
-- normal, already-clean aliases array (or NULL) is left untouched, so this
-- is safe to re-run.
--
-- Run the preview SELECT first and eyeball it against the live anglers
-- before running the UPDATE -- there's no dev env to test this against, so
-- this hasn't been run anywhere but reasoned through by hand.

-- ── Preview: what would change ──────────────────────────────────────────
SELECT
    a.id,
    a.name,
    a.aliases AS current_aliases,
    (
        SELECT ARRAY(
            SELECT TRIM(piece)
            FROM jsonb_array_elements_text(a.aliases[1]::jsonb) AS elem(alias_text)
            CROSS JOIN LATERAL unnest(string_to_array(elem.alias_text, ',')) AS piece
            WHERE TRIM(piece) <> ''
        )
    ) AS fixed_aliases
FROM anglers a
WHERE array_length(a.aliases, 1) = 1
  AND a.aliases[1] ~ '^\[.*\]$'
ORDER BY a.id;

-- ── Fix: apply it ────────────────────────────────────────────────────────
UPDATE anglers a
SET aliases = NULLIF(fixed.new_aliases, ARRAY[]::text[])
FROM (
    SELECT
        a2.id,
        ARRAY(
            SELECT TRIM(piece)
            FROM jsonb_array_elements_text(a2.aliases[1]::jsonb) AS elem(alias_text)
            CROSS JOIN LATERAL unnest(string_to_array(elem.alias_text, ',')) AS piece
            WHERE TRIM(piece) <> ''
        ) AS new_aliases
    FROM anglers a2
    WHERE array_length(a2.aliases, 1) = 1
      AND a2.aliases[1] ~ '^\[.*\]$'
) fixed
WHERE a.id = fixed.id;
