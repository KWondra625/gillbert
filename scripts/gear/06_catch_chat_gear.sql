-- Gear stage 5: Catch Chat remembers the tip-up and bait the angler mentions
-- (docs/plans/gear-tip-ups.md, "Stage 5"). The permanent conversations record keeps what was
-- said, like the other *_raw columns; the catch itself gets the tip-up and bait through
-- Save Catch -> catch_gear_set().
-- The n8n data table fish_catch_conversations needs the same two columns (string), added in
-- the n8n screen: the API key can't change data tables.
-- Safe to re-run.
ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS tip_up_raw varchar(255),
    ADD COLUMN IF NOT EXISTS bait_raw varchar(255);

-- Check: both columns are there
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'conversations' AND column_name IN ('tip_up_raw', 'bait_raw')
ORDER BY column_name;
