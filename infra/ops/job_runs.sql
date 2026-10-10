-- ops.job_runs: one row per run of an unattended job (backup, restore-test, ...), written by
-- the "Ops - Log Job Run" n8n workflow. Lives in the commons database, owned by ops_app.
--
-- Run once as postgres_admin, in a single transaction:
--   sudo docker exec -i data-postgres psql -U postgres_admin -d commons -1 -v ON_ERROR_STOP=1 < job_runs.sql
-- Then set the password (never in .env): \password ops_app

CREATE ROLE ops_app LOGIN;
GRANT CONNECT ON DATABASE commons TO ops_app;
CREATE SCHEMA ops AUTHORIZATION ops_app;
ALTER ROLE ops_app SET search_path = ops;

-- Columns for what gets filtered or sorted on; anything job-specific goes in details.
CREATE TABLE ops.job_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job         text NOT NULL,                 -- 'backup', later 'restore-test'
  server      text NOT NULL,
  status      text NOT NULL CHECK (status IN ('success', 'failed')),
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  duration_s  integer,
  size_bytes  bigint,
  error       text,                          -- failed step/line
  details     jsonb NOT NULL DEFAULT '{}',   -- job-specific extras
  logged_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ops.job_runs OWNER TO ops_app;
CREATE INDEX ON ops.job_runs (job, server, started_at DESC);
