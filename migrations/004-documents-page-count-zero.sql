ALTER TABLE documents DROP CONSTRAINT documents_page_count_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_page_count_non_negative CHECK (page_count >= 0);
