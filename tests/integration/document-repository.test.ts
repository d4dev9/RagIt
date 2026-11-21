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
} from './test-database'

describe.skipIf(!integrationEnabled)('PostgresDocumentRepository', () => {
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

  async function saveDocument(
    sessionId: SessionId,
    document: DocumentRecord = createDocumentRecord()
  ): Promise<DocumentRecord> {
    await documents.save(sessionId, document)

    return document
  }

  it('guarda, recupera y lista documentos de una sesión', async () => {
    const sessionId = await newSession()
    const first = await saveDocument(sessionId, createDocumentRecord())
    const second = await saveDocument(
      sessionId,
      createDocumentRecord({
        createdAt: new Date(first.createdAt.getTime() + 1),
      })
    )

    expect((await documents.findById(sessionId, first.id))?.id.toString()).toBe(
      first.id.toString()
    )
    expect(
      (await documents.listBySession(sessionId)).map((record) =>
        record.id.toString()
      )
    ).toEqual([first.id.toString(), second.id.toString()])
    expect(await documents.countBySession(sessionId)).toBe(2)
  })

  it('actualiza el estado de un documento de la sesión', async () => {
    const sessionId = await newSession()
    const document = await saveDocument(sessionId)
    const updatedAt = new Date(document.updatedAt.getTime() + 60_000)

    expect(
      await documents.updateStatus(sessionId, document.id, 'ready', updatedAt)
    ).toBe(true)
    const found = await documents.findById(sessionId, document.id)

    expect(found?.status).toBe('ready')
    expect(found?.updatedAt.getTime()).toBe(updatedAt.getTime())
  })

  it('no devuelve ni modifica documentos de otra sesión', async () => {
    const owner = await newSession()
    const other = await newSession()
    const document = await saveDocument(owner)

    expect(await documents.findById(other, document.id)).toBeNull()
    expect(await documents.listBySession(other)).toEqual([])
    expect(await documents.countBySession(other)).toBe(0)
    expect(await documents.delete(other, document.id)).toBe(false)
    expect(await documents.findById(owner, document.id)).not.toBeNull()
  })

  it('rechaza una ruta de almacenamiento duplicada', async () => {
    const sessionId = await newSession()
    const first = createDocumentRecord()
    const second = createDocumentRecord({ storagePath: first.storagePath })

    await documents.save(sessionId, first)

    await expect(documents.save(sessionId, second)).rejects.toMatchObject({
      code: '23505',
    })
  })

  it('elimina un documento y sus fragmentos en cascada', async () => {
    const sessionId = await newSession()
    const document = await saveDocument(sessionId)
    await chunks.saveMany(sessionId, document.id, [
      createChunkInput(0, 'contenido', createEmbedding(0.1)),
    ])

    expect(await documents.delete(sessionId, document.id)).toBe(true)
    expect(await chunks.listByDocument(sessionId, document.id)).toEqual([])
  })
})
