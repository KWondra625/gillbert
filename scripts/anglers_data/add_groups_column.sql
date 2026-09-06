-- One-time: add a free-text "groups" tag array to anglers, for the fun/
-- engagement group filter on Fish of Fame and Catches Listing (e.g. "Sass
-- Family", "Ice Fishing Crew"). Same shape as the existing aliases column --
-- an angler can carry multiple overlapping group tags.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is a no-op if it already exists.

ALTER TABLE anglers
    ADD COLUMN IF NOT EXISTS groups varchar(255)[];
