-- Expands fish_species from its original 10 rows to the curated ~30-species
-- roster (plus a permanent "Other" catch-all), sourced from the WI DNR's most-
-- common-species page and general fishing regulations pamphlet.
--
-- Run this after add_fish_species_metadata_columns.sql.
--
-- STEP 1 renames/cleans up the 5 existing rows whose `name` is changing, plus
-- fixes 2 existing rows (Muskellunge, Bluegill) whose aliases were stored as a
-- single crammed string ("Muskie; Musky") instead of separate array elements,
-- which meant they never actually matched on either nickname alone. This step
-- is written to run once — re-running it will reset these rows' aliases/
-- display override/notes back to these values, so skip it on any later re-run.
--
-- STEP 2 is a single upsert covering the full roster (including the 5 renamed
-- above, plus the 5 untouched originals, plus all new species). It's keyed on
-- `name` and only refreshes the DNR-sourced columns (family_display_name,
-- family_scientific_name, dnr_url) on conflict — status, aliases, notes, and
-- display_name_override are left alone for existing rows so future re-runs
-- (e.g. after a DNR site refresh) never stomp anything you've hand-curated.

-- ── STEP 1: one-time renames + alias cleanup on existing rows ──────────────

-- "Bass" -> Largemouth Bass (old aliases bundled LMB/SMB into one string;
-- Smallmouth Bass becomes its own row in Step 2)
UPDATE fish_species
SET name = 'Largemouth Bass',
    aliases = ARRAY['LMB', 'Largey']
WHERE id = 2;

-- Fix crammed alias string, and display as "Musky"
UPDATE fish_species
SET aliases = ARRAY['Muskie', 'Musky'],
    display_name_override = 'Musky'
WHERE id = 4;

-- Fix crammed alias string
UPDATE fish_species
SET aliases = ARRAY['Blue Gill', 'Gill']
WHERE id = 5;

-- "Crappie" -> Black Crappie (no catches logged yet, so no data risk; White
-- Crappie becomes its own row in Step 2)
UPDATE fish_species
SET name = 'Black Crappie',
    aliases = NULL
WHERE id = 6;

-- "Perch" -> Yellow Perch, with "Perch" as both the display override and an
-- alias (display override controls the UI label; alias is what chat matches on)
UPDATE fish_species
SET name = 'Yellow Perch',
    aliases = ARRAY['Perch'],
    display_name_override = 'Perch'
WHERE id = 7;

-- "Dogfish" -> Bowfin (the real species name; "Dogfish" becomes the alias)
UPDATE fish_species
SET name = 'Bowfin',
    aliases = ARRAY['Dogfish']
WHERE id = 8;

-- "Sunfish" -> Pumpkinseed (not a distinct species; matches your buddies'
-- description of a bright yellow/orange bluegill-shaped fish)
UPDATE fish_species
SET name = 'Pumpkinseed'
WHERE id = 10;

-- ── STEP 2: upsert the full roster ──────────────────────────────────────────

INSERT INTO fish_species
    (name, status, aliases, notes, family_display_name, family_scientific_name, dnr_url, display_name_override)
VALUES
    -- Bass
    ('Largemouth Bass',     'Active', ARRAY['LMB', 'Largey'], NULL, 'Bass',              'Centrarchidae', 'https://dnr.wisconsin.gov/topic/fishing/species/lmbass.html',   NULL),
    ('Smallmouth Bass',     'Active', ARRAY['SMB'],           NULL, 'Bass',              'Centrarchidae', 'https://dnr.wisconsin.gov/topic/fishing/species/smbass.html',   NULL),
    -- Panfish
    ('Bluegill',            'Active', ARRAY['Blue Gill','Gill'], NULL, 'Panfish',        'Centrarchidae', 'https://dnr.wisconsin.gov/topic/fishing/species/bluegill.html', NULL),
    ('Pumpkinseed',         'Active', NULL,                   NULL, 'Panfish',           'Centrarchidae', 'https://dnr.wisconsin.gov/topic/fishing/species/pumpkinseed.html', NULL),
    ('Black Crappie',       'Active', NULL,                   NULL, 'Panfish',           'Centrarchidae', 'https://dnr.wisconsin.gov/topic/fishing/species/bcrappie.html', NULL),
    ('White Crappie',       'Active', NULL,                   NULL, 'Panfish',           'Centrarchidae', NULL, NULL),
    ('Rock Bass',           'Active', NULL,                   NULL, 'Panfish',           'Centrarchidae', NULL, NULL),
    ('Yellow Perch',        'Active', ARRAY['Perch'],         NULL, 'Panfish',           'Percidae',      'https://dnr.wisconsin.gov/topic/fishing/species/yperch.html',   'Perch'),
    -- Pike
    ('Northern Pike',       'Active', ARRAY['Pike'],          NULL, 'Pike',              'Esocidae',      'https://dnr.wisconsin.gov/topic/fishing/species/npike.html',    NULL),
    ('Muskellunge',         'Active', ARRAY['Muskie','Musky'],NULL, 'Pike',              'Esocidae',      'https://dnr.wisconsin.gov/topic/fishing/species/musky.html',    'Musky'),
    -- Walleye
    ('Walleye',             'Active', ARRAY['Pickerel'],      NULL, 'Walleye',           'Percidae',      'https://dnr.wisconsin.gov/topic/fishing/species/walleye.html',  NULL),
    ('Sauger',               'Active', NULL,                  NULL, 'Walleye',           'Percidae',      NULL, NULL),
    -- Catfish/Bullhead
    ('Channel Catfish',     'Active', NULL,                   NULL, 'Catfish/Bullhead',  'Ictaluridae',   'https://dnr.wisconsin.gov/topic/fishing/species/catfish.html',  NULL),
    ('Flathead Catfish',    'Active', NULL,                   NULL, 'Catfish/Bullhead',  'Ictaluridae',   'https://dnr.wisconsin.gov/topic/fishing/species/catfish.html',  NULL),
    ('Black Bullhead',      'Active', NULL,                   NULL, 'Catfish/Bullhead',  'Ictaluridae',   'https://dnr.wisconsin.gov/topic/fishing/species/bullhead.html', NULL),
    ('Brown Bullhead',      'Active', NULL,                   NULL, 'Catfish/Bullhead',  'Ictaluridae',   'https://dnr.wisconsin.gov/topic/fishing/species/bullhead.html', NULL),
    ('Yellow Bullhead',     'Active', NULL,                   NULL, 'Catfish/Bullhead',  'Ictaluridae',   'https://dnr.wisconsin.gov/topic/fishing/species/bullhead.html', NULL),
    -- Sturgeon
    ('Lake Sturgeon',       'Active', NULL,                   NULL, 'Sturgeon',          'Acipenseridae', 'https://dnr.wisconsin.gov/topic/fishing/species/sturgeon.html', NULL),
    ('Shovelnose Sturgeon', 'Active', NULL,                   NULL, 'Sturgeon',          'Acipenseridae', NULL, NULL),
    -- Temperate Bass
    ('White Bass',          'Active', NULL,                   NULL, 'Temperate Bass',    'Moronidae',     NULL, NULL),
    ('Yellow Bass',         'Active', NULL,                   NULL, 'Temperate Bass',    'Moronidae',     NULL, NULL),
    -- Trout/Salmon
    ('Rainbow Trout',       'Active', NULL,                   NULL, 'Trout/Salmon',      'Salmonidae',    'https://dnr.wisconsin.gov/topic/fishing/species/troutsalmon.html', NULL),
    ('Brown Trout',         'Active', NULL,                   NULL, 'Trout/Salmon',      'Salmonidae',    'https://dnr.wisconsin.gov/topic/fishing/species/troutsalmon.html', NULL),
    ('Brook Trout',         'Active', NULL,                   NULL, 'Trout/Salmon',      'Salmonidae',    'https://dnr.wisconsin.gov/topic/fishing/species/troutsalmon.html', NULL),
    ('Lake Trout',          'Active', NULL,                   NULL, 'Trout/Salmon',      'Salmonidae',    'https://dnr.wisconsin.gov/topic/fishing/species/troutsalmon.html', NULL),
    ('Chinook Salmon',      'Active', NULL,                   NULL, 'Trout/Salmon',      'Salmonidae',    'https://dnr.wisconsin.gov/topic/fishing/species/troutsalmon.html', NULL),
    ('Coho Salmon',         'Active', NULL,                   NULL, 'Trout/Salmon',      'Salmonidae',    'https://dnr.wisconsin.gov/topic/fishing/species/troutsalmon.html', NULL),
    -- Cisco/Whitefish
    ('Cisco',                'Active', ARRAY['Lake Herring'], NULL, 'Cisco/Whitefish',   'Salmonidae',    NULL, NULL),
    ('Lake Whitefish',      'Active', NULL,                   NULL, 'Cisco/Whitefish',   'Salmonidae',    NULL, NULL),
    -- Other common catches
    ('Bowfin',               'Active', ARRAY['Dogfish'],      NULL, 'Bowfin',            'Amiidae',       NULL, NULL),
    ('Freshwater Drum',     'Active', NULL,                   NULL, 'Drum',              'Sciaenidae',    NULL, NULL),
    ('Common Carp',         'Active', NULL,                   NULL, 'Carp',              'Cyprinidae',    NULL, NULL),
    -- Catch-all
    ('Other',                'Active', NULL,                  NULL, NULL, NULL, NULL, NULL)

ON CONFLICT (name) DO UPDATE SET
    family_display_name    = EXCLUDED.family_display_name,
    family_scientific_name = EXCLUDED.family_scientific_name,
    dnr_url                 = EXCLUDED.dnr_url,
    updated_at               = now();
