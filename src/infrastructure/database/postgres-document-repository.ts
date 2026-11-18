import type { Pool } from 'pg'
import { DocumentId } from '../../domain/documents/document-id'
import { DocumentState } from '../../domain/documents/document-status'
import type { DocumentStatus } from '../../domain/documents/document-status'
import type { SessionId } from '../../domain/sessions/session-id'
import type {
  DocumentRecord,
  DocumentRepository,
} from '../../ports/documents/document-repository'

type DocumentRow = {
  id: string
  status: string
  size_bytes: number
  page_count: number
  created_at: Date
  updated_at: Date
}

function toRecord(row: DocumentRow): DocumentRecord {
  return {
    id: DocumentId.create(row.id),
    status: DocumentState.from(row.status).status,
    sizeBytes: row.size_bytes,
    pageCount: row.page_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class PostgresDocumentRepository implements DocumentRepository {
  constructor(private readonly pool: Pool) {}

  async save(sessionId: SessionId, document: DocumentRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO documents (
          id,
          session_id,
          status,
          size_bytes,
          page_count,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE
        SET status = EXCLUDED.status,
            size_bytes = EXCLUDED.size_bytes,
            page_count = EXCLUDED.page_count,
            updated_at = EXCLUDED.updated_at
        WHERE documents.session_id = EXCLUDED.session_id
      `,
      [
        document.id.toString(),
        sessionId.toString(),
        document.status,
        document.sizeBytes,
        document.pageCount,
        document.createdAt,
        document.updatedAt,
      ]
    )
  }

  async findById(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<DocumentRecord | null> {
    const result = await this.pool.query<DocumentRow>(
      `
        SELECT id, status, size_bytes, page_count, created_at, updated_at
        FROM documents
        WHERE id = $1 AND session_id = $2
      `,
      [documentId.toString(), sessionId.toString()]
    )
    const row = result.rows[0]

    return row ? toRecord(row) : null
  }

  async listBySession(
    sessionId: SessionId
  ): Promise<readonly DocumentRecord[]> {
    const result = await this.pool.query<DocumentRow>(
      `
        SELECT id, status, size_bytes, page_count, created_at, updated_at
        FROM documents
        WHERE session_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [sessionId.toString()]
    )

    return result.rows.map(toRecord)
  }

  async updateStatus(
    sessionId: SessionId,
    documentId: DocumentId,
    status: DocumentStatus,
    updatedAt: Date
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE documents
        SET status = $1, updated_at = $2
        WHERE id = $3 AND session_id = $4
      `,
      [status, updatedAt, documentId.toString(), sessionId.toString()]
    )

    return (result.rowCount ?? 0) > 0
  }

  async countBySession(sessionId: SessionId): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM documents
        WHERE session_id = $1
      `,
      [sessionId.toString()]
    )

    return result.rows[0]?.count ?? 0
  }

  async delete(sessionId: SessionId, documentId: DocumentId): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM documents WHERE id = $1 AND session_id = $2',
      [documentId.toString(), sessionId.toString()]
    )

    return (result.rowCount ?? 0) > 0
  }
}
