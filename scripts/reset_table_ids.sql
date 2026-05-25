    --Run this script to ensure all id value sequences are re-aligned.  Harmless to run if this is already working.
    SELECT setval('anglers_id_seq', (SELECT MAX(id) FROM anglers));
    SELECT setval('bodies_of_water_id_seq', (SELECT MAX(id) FROM bodies_of_water));
    SELECT setval('catches_id_seq', (SELECT MAX(id) FROM catches));
    SELECT setval('catch_media_id_seq', (SELECT MAX(id) FROM catch_media));
    SELECT setval('conversations_id_seq', (SELECT MAX(id) FROM conversations));
    SELECT setval('fish_species_id_seq', (SELECT MAX(id) FROM fish_species));