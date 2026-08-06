-- Upserts the curated ~30-species roster (plus a permanent "Other"
-- catch-all), sourced from the WI DNR's most-common-species page and general
-- fishing regulations pamphlet. See fish_species_dnr_process.md for the full
-- sourcing methodology and refresh process.
--
-- Safe to re-run anytime (e.g. after a DNR site refresh) — keyed on `name`,
-- and on conflict only refreshes the DNR-sourced columns (family_display_name,
-- family_scientific_name, dnr_url). status, aliases, notes, and
-- display_name_override are left alone for existing rows, so anything
-- hand-curated through the admin UI always survives a re-run untouched.

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
