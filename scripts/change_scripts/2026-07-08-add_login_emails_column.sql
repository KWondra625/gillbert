--Run once against prod to add the login_emails column to an existing anglers table.
--Safe to re-run: IF NOT EXISTS guards against double-adding the column.
ALTER TABLE anglers ADD COLUMN IF NOT EXISTS login_emails varchar(255)[];