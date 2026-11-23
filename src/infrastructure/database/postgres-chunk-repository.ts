import type { Pool } from 'pg'
import { ChunkId } from '../../domain/documents/chunk-id'
import { DocumentId } from '../../domain/documents/document-id'
import { assertEmbedding } from '../../domain/documents/embedding'
import { InvalidChunkLimitError } from '../../domain/documents/document-errors'
import { EmbeddingModelMismatchError } from '../../domain/retrieval/retrieval-errors'
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
  embedding_model: string | null
  created_at: Date
  distance?: number
}

type SearchChunkRow = ChunkRow & { display_name: string }

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
    embeddingModel: row.embedding_model,
    createdAt: row.created_at,
  }
}

export class PostgresChunkRepository implements ChunkRepository {
  constructor(private readonly pool: Pool) {}

  async saveMany(
    sessionId: SessionId,
    documentId: DocumentId,
    chunks: readonly ChunkInput[],
    embeddingModel: string
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
              embedding,
              embedding_model
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8)
          `,
          [
            chunk.id.toString(),
            documentId.toString(),
            sessionId.toString(),
            chunk.page,
            chunk.index,
            chunk.content,
            toVectorLiteral(chunk.embedding),
            embeddingModel,
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
        SELECT id, document_id, page, chunk_index, content, embedding, embedding_model, created_at
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
    limit: number,
    embeddingModel: string
  ): Promise<readonly ChunkMatch[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new InvalidChunkLimitError()
    }

    const storedModels = await this.pool.query<{
      embedding_model: string | null
    }>(
      `
        SELECT DISTINCT chunks.embedding_model
        FROM chunks
        INNER JOIN documents
          ON documents.id = chunks.document_id
          AND documents.session_id = chunks.session_id
        WHERE chunks.session_id = $1
          AND documents.storage_path IS NOT NULL
      `,
      [sessionId.toString()]
    )

    if (
      storedModels.rows.some(
        (row) => row.embedding_model !== embeddingModel
      )
    ) {
      throw new EmbeddingModelMismatchError()
    }

    const result = await this.pool.query<SearchChunkRow>(
      `
        SELECT
          chunks.id,
          chunks.document_id,
          documents.display_name,
          chunks.page,
          chunks.chunk_index,
          chunks.content,
          chunks.embedding,
          chunks.embedding_model,
          chunks.created_at,
          chunks.embedding <=> $2::vector AS distance
        FROM chunks
        INNER JOIN documents
          ON documents.id = chunks.document_id
          AND documents.session_id = chunks.session_id
        WHERE chunks.session_id = $1
          AND documents.storage_path IS NOT NULL
          AND chunks.embedding_model = $4
        ORDER BY chunks.embedding <=> $2::vector
        LIMIT $3
      `,
      [sessionId.toString(), toVectorLiteral(embedding), limit, embeddingModel]
    )

    return result.rows.map((row) => ({
      ...toRecord(row),
      displayName: row.display_name,
      distance: row.distance ?? 0,
    }))
  }

  async listForReindex(
    afterId: ChunkId | null,
    limit: number,
    sessionId?: SessionId
  ): Promise<readonly { id: ChunkId; content: string }[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new InvalidChunkLimitError()
    }

    const result = await this.pool.query<{ id: string; content: string }>(
      `
        SELECT id, content
        FROM chunks
        WHERE ($1::uuid IS NULL OR id > $1::uuid)
          AND ($3::uuid IS NULL OR session_id = $3::uuid)
        ORDER BY id ASC
        LIMIT $2
      `,
      [afterId?.toString() ?? null, limit, sessionId?.toString() ?? null]
    )

    return result.rows.map((row) => ({
      id: ChunkId.create(row.id),
      content: row.content,
    }))
  }

  async updateEmbedding(
    chunkId: ChunkId,
    embedding: readonly number[],
    embeddingModel: string
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE chunks
        SET embedding = $2::vector, embedding_model = $3
        WHERE id = $1
      `,
      [chunkId.toString(), toVectorLiteral(embedding), embeddingModel]
    )
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
