import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { reindexEmbeddings } from '../../src/application/reindex-embeddings'
import { PostgresChunkRepository } from '../../src/infrastructure/database/postgres-chunk-repository'
import { PostgresDocumentRepository } from '../../src/infrastructure/database/postgres-document-repository'
import { PostgresSessionRepository } from '../../src/infrastructure/database/postgres-session-repository'
import type { EmbeddingProvider } from '../../src/ports/embedding-provider'
import type { SessionId } from '../../src/domain/sessions/session-id'
import {
  createAppPool,
  createChunkInput,
  createDocumentRecord,
  createEmbedding,
  createSession,
  integrationEnabled,
  migrateDatabase,
  TEST_EMBEDDING_MODEL_NAME,
} from './test-database'

const REINDEX_MODEL_NAME = 'fake-reindex-model'

class FakeReindexEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = REINDEX_MODEL_NAME
  readonly batches: string[][] = []

  async embed(texts: string[]): Promise<number[][]> {
    this.batches.push(texts)

    return texts.map(() => [...createEmbedding(0.75)])
  }
}

describe.skipIf(!integrationEnabled)('reindexEmbeddings', () => {
  let pool: Pool
  let sessions: PostgresSessionRepository
  let documents: PostgresDocumentRepository
  let chunks: PostgresChunkRepository
  const created: SessionId[] = []

  beforeAll(async () => {
    await migrateDatabase()
    pool = createAppPool()
    sessions = new PostgresSessionRepository(pool)
    documents = new PostgresDocumentRepository(pool)
    chunks = new PostgresChunkRepository(pool)
  })

  afterAll(async () => {
    for (const sessionId of created) {
      await sessions.delete(sessionId)
    }

    await pool.end()
  })

  it('recalcula fragmentos en lotes y guarda embedding y modelo', async () => {
    const session = createSession()
    await sessions.save(session)
    created.push(session.id)
    const document = createDocumentRecord({ status: 'ready' })
    await documents.save(session.id, document)
    await chunks.saveMany(
      session.id,
      document.id,
      [
        createChunkInput(0, 'primer fragmento', createEmbedding(0.1)),
        createChunkInput(1, 'segundo fragmento', createEmbedding(0.2), 2),
        createChunkInput(2, 'tercer fragmento', createEmbedding(0.3), 3),
      ],
      TEST_EMBEDDING_MODEL_NAME
    )
    await pool.query(
      'UPDATE chunks SET embedding_model = NULL WHERE document_id = $1',
      [document.id.toString()]
    )
    const provider = new FakeReindexEmbeddingProvider()

    const updated = await reindexEmbeddings({
      chunkRepository: chunks,
      embeddingProvider: provider,
      batchSize: 2,
      sessionId: session.id,
    })
    const stored = await chunks.listByDocument(session.id, document.id)

    expect(updated).toBe(3)
    expect(provider.batches.map((batch) => batch.length)).toEqual([2, 1])
    expect(stored.map((chunk) => chunk.embeddingModel)).toEqual([
      REINDEX_MODEL_NAME,
      REINDEX_MODEL_NAME,
      REINDEX_MODEL_NAME,
    ])
    expect(stored.every((chunk) => chunk.embedding.every((value) => value === 0.75))).toBe(true)
  })
})
