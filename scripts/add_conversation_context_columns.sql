-- One-time migration: add the two columns already in use on the n8n Data Table
-- (fish_catch_conversations) to the permanent Postgres conversations table, so
-- Insert Conversation Record / Finalize Conversation Record can persist them.
ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS logged_in_angler_name varchar(255),
    ADD COLUMN IF NOT EXISTS recent_context_note TEXT;
