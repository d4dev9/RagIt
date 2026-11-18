import type { Pool } from 'pg'
import { ChunkId } from '../../domain/documents/chunk-id'
import { DocumentId } from '../../domain/documents/document-id'
import { assertEmbedding } from '../../domain/documents/embedding'
import { InvalidChunkLimitError } from '../../domain/documents/document-errors'
import type { SessionId } from '../../domain/sessions/session-id'
import type {
  ChunkInput,
  ChunkMatch,
  ChunkRecord,
  ChunkRepository,
} from '../../ports/documents/chunk-repository'

type ChunkRow = {
  id: string
  document_id: string
  page: number
  chunk_index: number
  content: string
  embedding: string
  created_at: Date
  distance?: number
}

function toVectorLiteral(embedding: readonly number[]): string {
  assertEmbedding(embedding)

  return `[${embedding.join(',')}]`
}

function parseEmbedding(value: string): readonly number[] {
  return value
    .slice(1, -1)
    .split(',')
    .map((component) => Number(component))
}

function toRecord(row: ChunkRow): ChunkRecord {
  return {
    id: ChunkId.create(row.id),
    documentId: DocumentId.create(row.document_id),
    page: row.page,
    index: row.chunk_index,
    content: row.content,
    embedding: parseEmbedding(row.embedding),
    createdAt: row.created_at,
  }
}

export class PostgresChunkRepository implements ChunkRepository {
  constructor(private readonly pool: Pool) {}

  async saveMany(
    sessionId: SessionId,
    documentId: DocumentId,
    chunks: readonly ChunkInput[]
  ): Promise<void> {
    if (chunks.length === 0) {
      return
    }

    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      for (const chunk of chunks) {
        await client.query(
          `
            INSERT INTO chunks (
              id,
              document_id,
              session_id,
              page,
              chunk_index,
              content,
              embedding
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
          `,
          [
            chunk.id.toString(),
            documentId.toString(),
            sessionId.toString(),
            chunk.page,
            chunk.index,
            chunk.content,
            toVectorLiteral(chunk.embedding),
          ]
        )
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async listByDocument(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<readonly ChunkRecord[]> {
    const result = await this.pool.query<ChunkRow>(
      `
        SELECT id, document_id, page, chunk_index, content, embedding, created_at
        FROM chunks
        WHERE session_id = $1 AND document_id = $2
        ORDER BY page ASC, chunk_index ASC
      `,
      [sessionId.toString(), documentId.toString()]
    )

    return result.rows.map(toRecord)
  }

  async searchBySession(
    sessionId: SessionId,
    embedding: readonly number[],
    limit: number
  ): Promise<readonly ChunkMatch[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new InvalidChunkLimitError()
    }

    const result = await this.pool.query<ChunkRow>(
      `
        SELECT
          id,
          document_id,
          page,
          chunk_index,
          content,
          embedding,
          created_at,
          embedding <=> $2::vector AS distance
        FROM chunks
        WHERE session_id = $1
        ORDER BY embedding <=> $2::vector
        LIMIT $3
      `,
      [sessionId.toString(), toVectorLiteral(embedding), limit]
    )

    return result.rows.map((row) => ({
      ...toRecord(row),
      distance: row.distance ?? 0,
    }))
  }

  async deleteByDocument(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM chunks WHERE session_id = $1 AND document_id = $2',
      [sessionId.toString(), documentId.toString()]
    )

    return result.rowCount ?? 0
  }
}
