ALTER TABLE documents
  ADD COLUMN storage_path text,
  ADD COLUMN display_name text;

ALTER TABLE documents
  ADD CONSTRAINT documents_storage_path_unique UNIQUE (storage_path),
  ADD CONSTRAINT documents_storage_path_format
    CHECK (
      storage_path IS NULL OR
      storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'
    ),
  ADD CONSTRAINT documents_display_name_length
    CHECK (
      display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 120
    );

CREATE INDEX IF NOT EXISTS documents_session_idx ON documents (session_id);
