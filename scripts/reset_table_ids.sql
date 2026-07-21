--Run this script to ensure all id value sequences are re-aligned.  Harmless to run if this is already working.
--Safe to run on empty tables too: falls back to 1 with is_called=false instead of erroring on a NULL MAX(id).
SELECT setval('anglers_id_seq', COALESCE((SELECT MAX(id) FROM anglers), 1), (SELECT MAX(id) FROM anglers) IS NOT NULL);
SELECT setval('bodies_of_water_id_seq', COALESCE((SELECT MAX(id) FROM bodies_of_water), 1), (SELECT MAX(id) FROM bodies_of_water) IS NOT NULL);
SELECT setval('catches_id_seq', COALESCE((SELECT MAX(id) FROM catches), 1), (SELECT MAX(id) FROM catches) IS NOT NULL);
SELECT setval('catch_media_id_seq', COALESCE((SELECT MAX(id) FROM catch_media), 1), (SELECT MAX(id) FROM catch_media) IS NOT NULL);
--chat_messages is created/owned by the n8n chat workflow (Postgres Chat Memory node), not by this repo's scripts/tables/*.sql.
SELECT setval('chat_messages_id_seq', COALESCE((SELECT MAX(id) FROM chat_messages), 1), (SELECT MAX(id) FROM chat_messages) IS NOT NULL);
SELECT setval('conversations_id_seq', COALESCE((SELECT MAX(id) FROM conversations), 1), (SELECT MAX(id) FROM conversations) IS NOT NULL);
SELECT setval('fish_species_id_seq', COALESCE((SELECT MAX(id) FROM fish_species), 1), (SELECT MAX(id) FROM fish_species) IS NOT NULL);