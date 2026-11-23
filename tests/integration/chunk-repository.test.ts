import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  InvalidChunkLimitError,
  InvalidEmbeddingError,
} from '../../src/domain/documents/document-errors'
import { SessionId } from '../../src/domain/sessions/session-id'
import { PostgresChunkRepository } from '../../src/infrastructure/database/postgres-chunk-repository'
import { PostgresDocumentRepository } from '../../src/infrastructure/database/postgres-document-repository'
import { PostgresSessionRepository } from '../../src/infrastructure/database/postgres-session-repository'
import type { DocumentId } from '../../src/domain/documents/document-id'
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

describe.skipIf(!integrationEnabled)('PostgresChunkRepository', () => {
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

  async function newDocument(): Promise<{
    sessionId: SessionId
    documentId: DocumentId
  }> {
    const session = createSession()
    await sessions.save(session)
    created.push(session.id)
    const document = createDocumentRecord()
    await documents.save(session.id, document)

    return { sessionId: session.id, documentId: document.id }
  }

  it('tiene un índice HNSW sobre el vector de embeddings', async () => {
    const result = await pool.query<{ indexdef: string }>(
      `
        SELECT indexdef
        FROM pg_indexes
        WHERE indexname = 'chunks_embedding_hnsw_idx'
      `
    )

    expect(result.rows[0]?.indexdef).toContain('USING hnsw')
  })

  it('guarda y lista fragmentos ordenados por página e índice', async () => {
    const { sessionId, documentId } = await newDocument()
    const embedding = createEmbedding(0.2)
    const second = createChunkInput(1, 'segundo', embedding, 2)
    const first = createChunkInput(0, 'primero', embedding, 1)
    await chunks.saveMany(sessionId, documentId, [second, first], TEST_EMBEDDING_MODEL_NAME)
    const stored = await chunks.listByDocument(sessionId, documentId)

    expect(stored.map((chunk) => chunk.content)).toEqual(['primero', 'segundo'])
    expect(stored[0]?.embedding).toHaveLength(768)
  })

  it('busca los fragmentos más cercanos dentro de la sesión', async () => {
    const { sessionId, documentId } = await newDocument()
    const near = createChunkInput(0, 'cercano', createEmbedding(1))
    const far = createChunkInput(1, 'lejano', createEmbedding(-1))
    await chunks.saveMany(sessionId, documentId, [near, far], TEST_EMBEDDING_MODEL_NAME)
    const found = await chunks.searchBySession(
      sessionId,
      createEmbedding(1),
      1,
      TEST_EMBEDDING_MODEL_NAME
    )

    expect(found).toHaveLength(1)
    expect(found[0]?.content).toBe('cercano')
    expect(found[0]?.distance).toBeCloseTo(0, 6)
  })

  it('excluye de la búsqueda los fragmentos de documentos sin archivo', async () => {
    const session = createSession()
    await sessions.save(session)
    created.push(session.id)
    const legacyDocument = createDocumentRecord({ storagePath: null })
    await documents.save(session.id, legacyDocument)
    await chunks.saveMany(session.id, legacyDocument.id, [
      createChunkInput(0, 'fragmento heredado sin archivo', createEmbedding(1)),
    ], TEST_EMBEDDING_MODEL_NAME)

    const found = await chunks.searchBySession(
      session.id,
      createEmbedding(1),
      5,
      TEST_EMBEDDING_MODEL_NAME
    )

    expect(found).toEqual([])
  })

  it('elimina los fragmentos de un documento', async () => {
    const { sessionId, documentId } = await newDocument()
    await chunks.saveMany(sessionId, documentId, [
      createChunkInput(0, 'contenido', createEmbedding(0.3)),
    ], TEST_EMBEDDING_MODEL_NAME)

    expect(await chunks.deleteByDocument(sessionId, documentId)).toBe(1)
    expect(await chunks.listByDocument(sessionId, documentId)).toEqual([])
  })

  it('rechaza un límite de búsqueda inválido', async () => {
    const { sessionId } = await newDocument()

    await expect(
      chunks.searchBySession(
        sessionId,
        createEmbedding(0.1),
        0,
        TEST_EMBEDDING_MODEL_NAME
      )
    ).rejects.toThrow(InvalidChunkLimitError)
  })

  it('rechaza un embedding con dimensión incorrecta', async () => {
    const { sessionId, documentId } = await newDocument()

    await expect(
      chunks.saveMany(sessionId, documentId, [
        createChunkInput(0, 'contenido', [0.1, 0.2]),
      ], TEST_EMBEDDING_MODEL_NAME)
    ).rejects.toThrow(InvalidEmbeddingError)
  })
})
