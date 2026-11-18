CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type = 'ingest_document'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  error text
);

INSERT INTO schema_migrations (version) VALUES ('002-jobs.sql');