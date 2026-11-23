import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { askQuestion } from '../../src/application/ask-question'
import type {
  AnswerModel,
  AnswerModelRequest,
} from '../../src/ports/answer-model'
import type { EmbeddingProvider } from '../../src/ports/embedding-provider'
import { PostgresChunkRepository } from '../../src/infrastructure/database/postgres-chunk-repository'
import { PostgresDocumentRepository } from '../../src/infrastructure/database/postgres-document-repository'
import { PostgresSessionRepository } from '../../src/infrastructure/database/postgres-session-repository'
import type { SessionId } from '../../src/domain/sessions/session-id'
import type { DocumentRecord } from '../../src/ports/documents/document-repository'
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

const QUESTION_EMBEDDING = createEmbedding(0.5)

class FixedEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = TEST_EMBEDDING_MODEL_NAME

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [...QUESTION_EMBEDDING])
  }
}

class RecordingAnswerModel implements AnswerModel {
  readonly requests: AnswerModelRequest[] = []
  response = 'La factura tiene un total de 100 [1].'

  async answer(request: AnswerModelRequest): Promise<string> {
    this.requests.push(request)

    return this.response
  }
}

describe.skipIf(!integrationEnabled)('askQuestion contra Postgres', () => {
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

  async function newSession(): Promise<SessionId> {
    const session = createSession()
    await sessions.save(session)
    created.push(session.id)

    return session.id
  }

  async function seedDocument(sessionId: SessionId): Promise<DocumentRecord> {
    const document = createDocumentRecord({
      status: 'ready',
      displayName: 'comprobante_MKW-03252.pdf',
    })
    await documents.save(sessionId, document)
    await chunks.saveMany(sessionId, document.id, [
      createChunkInput(0, 'contenido idéntico', createEmbedding(0.5), 1),
    ], TEST_EMBEDDING_MODEL_NAME)

    return document
  }

  it('cita solo documentos de la sesión actual', async () => {
    const sessionA = await newSession()
    const sessionB = await newSession()
    const documentA = await seedDocument(sessionA)
    const documentB = await seedDocument(sessionB)
    const model = new RecordingAnswerModel()

    const result = await askQuestion(
      sessionA,
      '¿cuál es el total?',
      chunks,
      new FixedEmbeddingProvider(),
      model
    )

    expect(result.citations).toEqual([
      {
        index: 1,
        documentId: documentA.id.toString(),
        displayName: 'comprobante_MKW-03252.pdf',
        page: 1,
      },
    ])
    expect(model.requests[0]?.userPrompt).toContain('[1]\ncontenido idéntico')
    expect(model.requests[0]?.userPrompt).not.toContain(documentB.id.toString())
  })

  it('una pregunta con caracteres SQL no altera la base', async () => {
    const sessionId = await newSession()
    await seedDocument(sessionId)
    const model = new RecordingAnswerModel()

    const result = await askQuestion(
      sessionId,
      "'; DROP TABLE chunks; --",
      chunks,
      new FixedEmbeddingProvider(),
      model
    )
    const count = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM chunks'
    )

    expect(result.answer).toBe(model.response)
    expect(result.citations[0]).toMatchObject({
      displayName: 'comprobante_MKW-03252.pdf',
      page: 1,
    })
    expect(count.rows[0]?.count).toBeGreaterThan(0)
  })
})
