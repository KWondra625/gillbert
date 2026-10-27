-- One-time migration: dnr_url_verified becomes "not applicable" (NULL) for a body of
-- water with no DNR link. The flag answers "does the DNR lake-page link work?" (the
-- edit page's "DNR link is working" checkbox), which only has an answer once a WBIC
-- is linked. It was NOT NULL DEFAULT true, so a lake created with no DNR link failed
-- to save (the save workflow sends NULL for it), and unlinked lakes carried a
-- meaningless true/false.
--
-- After this: unlinked → NULL; linked → true on link, then whatever the admin sets.
-- The default is dropped too, so anything that inserts a lake without linking it
-- (Catch Chat adds unknown lakes by name) gets NULL rather than a claim about a link
-- that doesn't exist. Linking always sends the value explicitly.
--
-- Run on each server's database BEFORE that server's site gets the matching
-- create/edit page change, which starts sending NULL for unlinked lakes.
-- Safe to re-run.

BEGIN;

ALTER TABLE bodies_of_water
    ALTER COLUMN dnr_url_verified DROP NOT NULL,
    ALTER COLUMN dnr_url_verified DROP DEFAULT;

UPDATE bodies_of_water
SET dnr_url_verified = NULL
WHERE wbic IS NULL
  AND dnr_url_verified IS NOT NULL;

COMMIT;
