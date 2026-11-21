ALTER TABLE documents
  ALTER COLUMN storage_path DROP NOT NULL,
  ALTER COLUMN display_name DROP NOT NULL;
