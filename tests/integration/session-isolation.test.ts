import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionId } from '../../src/domain/sessions/session-id'
import { PostgresChunkRepository } from '../../src/infrastructure/database/postgres-chunk-repository'
import { PostgresDocumentRepository } from '../../src/infrastructure/database/postgres-document-repository'
import { PostgresSessionRepository } from '../../src/infrastructure/database/postgres-session-repository'
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

describe.skipIf(!integrationEnabled)('Aislamiento entre sesiones', () => {
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
    const document = createDocumentRecord()
    await documents.save(sessionId, document)
    await chunks.saveMany(sessionId, document.id, [
      createChunkInput(0, 'contenido idéntico', createEmbedding(0.4)),
      createChunkInput(1, 'segundo contenido idéntico', createEmbedding(0.6)),
    ], TEST_EMBEDDING_MODEL_NAME)

    return document
  }

  it('una sesión no recupera documentos ni fragmentos de otra', async () => {
    const sessionA = await newSession()
    const sessionB = await newSession()
    const documentA = await seedDocument(sessionA)
    const documentB = await seedDocument(sessionB)

    expect(
      (await documents.listBySession(sessionA)).map((document) =>
        document.id.toString()
      )
    ).toEqual([documentA.id.toString()])
    expect(await documents.findById(sessionA, documentB.id)).toBeNull()
    expect(await chunks.listByDocument(sessionA, documentB.id)).toEqual([])
    expect(await chunks.deleteByDocument(sessionA, documentB.id)).toBe(0)
    expect(await chunks.listByDocument(sessionB, documentB.id)).toHaveLength(2)
  })

  it('no permite guardar fragmentos en un documento de otra sesión', async () => {
    const sessionA = await newSession()
    const sessionB = await newSession()
    await seedDocument(sessionA)
    const documentB = await seedDocument(sessionB)

    await expect(
      chunks.saveMany(sessionA, documentB.id, [
        createChunkInput(2, 'intruso', createEmbedding(0.5), 2),
      ], TEST_EMBEDDING_MODEL_NAME)
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('la búsqueda vectorial solo devuelve fragmentos de la sesión', async () => {
    const sessionA = await newSession()
    const sessionB = await newSession()
    const documentA = await seedDocument(sessionA)
    const documentB = await seedDocument(sessionB)
    const found = await chunks.searchBySession(
      sessionA,
      createEmbedding(0.4),
      10,
      TEST_EMBEDDING_MODEL_NAME
    )

    expect(found).toHaveLength(2)
    expect(found.every((chunk) => chunk.documentId.equals(documentA.id))).toBe(
      true
    )
    expect(found.some((chunk) => chunk.documentId.equals(documentB.id))).toBe(
      false
    )
  })
})
