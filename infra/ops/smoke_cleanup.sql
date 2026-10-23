-- Smoke-test clean-up, part 2 of 2: delete the smoke-test rows and reset the counters, so the next real catch
-- gets the next catch number (Catch YY-<id>). Run in DBeaver on Bridge01's gillbert DB.
-- Part 1 (smoke_cleanup.py --delete) must have removed the test catches' media first; STEP 2 checks that.
-- Anything newer than the baseline is smoke-test data: the anglers aren't told until this is done.

-- STEP 0: on the night, right after the restore is verified (step 2) and before go-live.
-- Write the 4 numbers down; they're the baseline for STEP 1 and STEP 2.
SELECT (SELECT max(id) FROM catches)       AS catches,
       (SELECT max(id) FROM catch_media)   AS catch_media,
       (SELECT max(id) FROM conversations) AS conversations,
       (SELECT max(id) FROM chat_messages) AS chat_messages;

-- STEP 1: preview, read-only. Put the baseline in the VALUES row, run, and check every row is from the smoke test.
WITH b(catches, catch_media, conversations, chat_messages) AS (VALUES (0, 0, 0, 0))
SELECT 'catch' AS what, c.id, c.catch_number AS label, c.created_at, left(c.notes, 60) AS detail
  FROM catches c, b WHERE c.id > b.catches
UNION ALL
SELECT 'catch_media', m.id, m.original_filename, m.created_at, m.blob_path
  FROM catch_media m, b WHERE m.id > b.catch_media
UNION ALL
SELECT 'conversation', v.id, v.channel, v.created_at, v.logged_in_angler_name
  FROM conversations v, b WHERE v.id > b.conversations
UNION ALL
SELECT 'chat_message', x.id, x.session_id, NULL, left(x.message::text, 60)
  FROM chat_messages x, b WHERE x.id > b.chat_messages
ORDER BY 1, 2;

-- STEP 2: the clean-up. Same baseline in the 4 DECLARE lines. One statement, so it's all or nothing:
-- any check that fails stops it with an error and nothing is deleted.
DO $$
DECLARE
  b_catches  int := 0;   -- STEP 0 catches
  b_media    int := 0;   -- STEP 0 catch_media
  b_convs    int := 0;   -- STEP 0 conversations
  b_messages int := 0;   -- STEP 0 chat_messages
  expect_catches int := 2;
  n int;
BEGIN
  IF b_catches = 0 THEN RAISE EXCEPTION 'fill in the baseline first'; END IF;
  SELECT count(*) INTO n FROM catches WHERE id > b_catches;
  IF n <> expect_catches THEN
    RAISE EXCEPTION 'expected % test catch(es) newer than %, found %: look before deleting', expect_catches, b_catches, n;
  END IF;
  IF EXISTS (SELECT 1 FROM catch_media WHERE catch_id > b_catches) THEN
    RAISE EXCEPTION 'the test catches still have media: run smoke_cleanup.py --delete first';
  END IF;
  IF EXISTS (SELECT 1 FROM catch_media WHERE id > b_media) THEN
    RAISE EXCEPTION 'media newer than the baseline is on a real catch: look before deleting';
  END IF;
  IF EXISTS (SELECT 1 FROM catches WHERE id <= b_catches AND conversation_id > b_convs) THEN
    RAISE EXCEPTION 'a real catch points at a conversation newer than the baseline: look before deleting';
  END IF;

  DELETE FROM catches WHERE id > b_catches;          GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'catches deleted: %', n;
  DELETE FROM chat_messages WHERE id > b_messages;   GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'chat messages deleted: %', n;
  DELETE FROM conversations WHERE id > b_convs;      GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'conversations deleted: %', n;

  -- Counters back to the baseline (same pattern as scripts/reset_table_ids.sql)
  PERFORM setval('catches_id_seq',       COALESCE((SELECT max(id) FROM catches), 1),       (SELECT max(id) FROM catches) IS NOT NULL);
  PERFORM setval('catch_media_id_seq',   COALESCE((SELECT max(id) FROM catch_media), 1),   (SELECT max(id) FROM catch_media) IS NOT NULL);
  PERFORM setval('conversations_id_seq', COALESCE((SELECT max(id) FROM conversations), 1), (SELECT max(id) FROM conversations) IS NOT NULL);
  PERFORM setval('chat_messages_id_seq', COALESCE((SELECT max(id) FROM chat_messages), 1), (SELECT max(id) FROM chat_messages) IS NOT NULL);
  IF (SELECT max(id) FROM catches) <> b_catches THEN
    RAISE EXCEPTION 'newest catch is not the baseline after the clean-up';
  END IF;
  RAISE NOTICE 'done: the next real catch will be number %', b_catches + 1;
END $$;
