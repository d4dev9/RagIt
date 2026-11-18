CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  CONSTRAINT sessions_activity_after_creation CHECK (last_activity_at >= created_at)
);

CREATE INDEX sessions_last_activity_idx ON sessions (last_activity_at);

CREATE TABLE documents (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  page_count integer NOT NULL CHECK (page_count > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT documents_updated_after_creation CHECK (updated_at >= created_at),
  CONSTRAINT documents_id_session_unique UNIQUE (id, session_id)
);

CREATE INDEX documents_session_idx ON documents (session_id);
CREATE INDEX documents_session_status_idx ON documents (session_id, status);

CREATE TABLE chunks (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL,
  session_id uuid NOT NULL,
  page integer NOT NULL CHECK (page > 0),
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 800),
  embedding vector(768) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chunks_document_session_fk
    FOREIGN KEY (document_id, session_id)
    REFERENCES documents (id, session_id)
    ON DELETE CASCADE,
  CONSTRAINT chunks_document_page_index_unique UNIQUE (document_id, page, chunk_index)
);

CREATE INDEX chunks_session_idx ON chunks (session_id);
CREATE INDEX chunks_document_idx ON chunks (document_id);
CREATE INDEX chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, documents, chunks TO ragit_app;
