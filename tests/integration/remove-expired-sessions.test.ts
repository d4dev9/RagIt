import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeExpiredSessions } from '../../src/application/remove-expired-sessions'
import { SESSION_INACTIVITY_LIMIT_MS } from '../../src/domain/sessions/session'
import { LocalPdfFileStore } from '../../src/infrastructure/storage/pdf-file-store'
import { PostgresChunkRepository } from '../../src/infrastructure/database/postgres-chunk-repository'
import { PostgresDocumentRepository } from '../../src/infrastructure/database/postgres-document-repository'
import { PostgresJobQueue } from '../../src/infrastructure/database/postgres-job-queue'
import { PostgresSessionRepository } from '../../src/infrastructure/database/postgres-session-repository'
import type { SessionId } from '../../src/domain/sessions/session-id'
import {
  createAppPool,
  createChunkInput,
  createDocumentRecord,
  createEmbedding,
  createSession,
  integrationEnabled,
  migrateDatabase,
} from './test-database'

describe.skipIf(!integrationEnabled)('removeExpiredSessions (F-01, F-08)', () => {
  let pool: Pool
  let storageDirectory: string
  let files: LocalPdfFileStore
  let sessions: PostgresSessionRepository
  let documents: PostgresDocumentRepository
  let chunks: PostgresChunkRepository
  let jobs: PostgresJobQueue
  let expiredSessionId: SessionId
  let activeSessionId: SessionId
  let expiredFile: string
  let activeFile: string
  let expiredJobId: string
  let activeJobId: string

  beforeAll(async () => {
    await migrateDatabase()
    pool = createAppPool()
    storageDirectory = await mkdtemp(join(tmpdir(), 'ragit-expiry-'))
    files = new LocalPdfFileStore(storageDirectory)
    sessions = new PostgresSessionRepository(pool)
    documents = new PostgresDocumentRepository(pool)
    chunks = new PostgresChunkRepository(pool)
    jobs = new PostgresJobQueue(pool)

    const now = new Date()
    const expiredSession = createSession(
      new Date(now.getTime() - SESSION_INACTIVITY_LIMIT_MS - 60 * 60 * 1000)
    )
    const activeSession = createSession(
      new Date(now.getTime() - SESSION_INACTIVITY_LIMIT_MS + 60 * 60 * 1000)
    )
    expiredSessionId = expiredSession.id
    activeSessionId = activeSession.id
    await sessions.save(expiredSession)
    await sessions.save(activeSession)
    const pdf = await readFile(
      resolve('tests/fixtures/ocr/01_texto_factura.pdf')
    )
    expiredFile = await files.save(pdf)
    activeFile = await files.save(pdf)
    const expiredDocument = createDocumentRecord({
      storagePath: expiredFile,
      displayName: 'expirado.pdf',
      status: 'ready',
    })
    const activeDocument = createDocumentRecord({
      storagePath: activeFile,
      displayName: 'activo.pdf',
      status: 'ready',
    })
    await documents.save(expiredSessionId, expiredDocument)
    await documents.save(activeSessionId, activeDocument)
    await chunks.saveMany(expiredSessionId, expiredDocument.id, [
      createChunkInput(0, 'fragmento expirado', createEmbedding(0.2)),
    ])
    await chunks.saveMany(activeSessionId, activeDocument.id, [
      createChunkInput(0, 'fragmento activo', createEmbedding(0.2)),
    ])
    expiredJobId = (
      await jobs.submitIngestJob({
        documentId: expiredDocument.id.toString(),
        sessionId: expiredSessionId.toString(),
        storagePath: expiredFile,
        pdfByteLength: pdf.byteLength,
      })
    ).id
    activeJobId = (
      await jobs.submitIngestJob({
        documentId: activeDocument.id.toString(),
        sessionId: activeSessionId.toString(),
        storagePath: activeFile,
        pdfByteLength: pdf.byteLength,
      })
    ).id
  })

  afterAll(async () => {
    if (expiredSessionId) {
      await jobs.deleteBySession(expiredSessionId)
      await sessions.delete(expiredSessionId)
    }

    if (activeSessionId) {
      await jobs.deleteBySession(activeSessionId)
      await sessions.delete(activeSessionId)
    }

    await pool.end()
    await rm(storageDirectory, { recursive: true, force: true })
  })

  it('elimina solo la sesión con más de 24 horas de inactividad', async () => {
    const now = new Date()
    await files.remove(expiredFile)
    const result = await removeExpiredSessions(now, {
      sessionRepository: sessions,
      documentRepository: documents,
      chunkRepository: chunks,
      jobQueue: jobs,
      pdfFileStore: files,
    })

    expect(result).toEqual({ sessionsRemoved: 1, documentsRemoved: 1 })
    expect(await sessions.findById(expiredSessionId)).toBeNull()
    expect(await sessions.findById(activeSessionId)).not.toBeNull()
    expect(await documents.listBySession(expiredSessionId)).toEqual([])
    expect(await documents.listBySession(activeSessionId)).toHaveLength(1)
    expect(await jobs.getJob(expiredJobId)).toBeNull()
    expect(await jobs.getJob(activeJobId)).not.toBeNull()
    await expect(files.read(expiredFile)).rejects.toThrow()
    expect((await files.read(activeFile)).byteLength).toBeGreaterThan(0)

    const activeDocuments = await documents.listBySession(activeSessionId)
    const activeDocument = activeDocuments[0]

    expect(activeDocument).toBeDefined()

    if (!activeDocument) {
      throw new Error('El documento activo no fue conservado')
    }

    expect(
      await chunks.listByDocument(activeSessionId, activeDocument.id)
    ).toHaveLength(1)

    await expect(
      removeExpiredSessions(now, {
        sessionRepository: sessions,
        documentRepository: documents,
        chunkRepository: chunks,
        jobQueue: jobs,
        pdfFileStore: files,
      })
    ).resolves.toEqual({ sessionsRemoved: 0, documentsRemoved: 0 })
  })
})
