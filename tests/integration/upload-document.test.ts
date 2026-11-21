import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uploadDocument } from '../../src/application/upload-document'
import { DocumentQuotaExceededError } from '../../src/domain/documents/document-errors'
import { MAX_DOCUMENTS_PER_SESSION } from '../../src/domain/documents/document-limits'
import { DocumentId } from '../../src/domain/documents/document-id'
import { SessionId } from '../../src/domain/sessions/session-id'
import { PostgresDocumentRepository } from '../../src/infrastructure/database/postgres-document-repository'
import { PostgresJobQueue } from '../../src/infrastructure/database/postgres-job-queue'
import { PostgresSessionRepository } from '../../src/infrastructure/database/postgres-session-repository'
import { LocalPdfFileStore } from '../../src/infrastructure/storage/pdf-file-store'
import {
  createAppPool,
  createSession,
  integrationEnabled,
  migrateDatabase,
} from './test-database'

const PDF = readFileSync(resolve('tests/fixtures/ocr/01_texto_factura.pdf'))

describe.skipIf(!integrationEnabled)('uploadDocument con PostgreSQL (F-02, F-08)', () => {
  let pool: Pool
  let storageDir: string
  let store: LocalPdfFileStore
  let sessions: PostgresSessionRepository
  let documents: PostgresDocumentRepository
  let queue: PostgresJobQueue
  const sessionIds: SessionId[] = []

  beforeAll(async () => {
    await migrateDatabase()
    pool = createAppPool()
    storageDir = await mkdtemp(join(tmpdir(), 'ragit-upload-'))
    store = new LocalPdfFileStore(storageDir)
    sessions = new PostgresSessionRepository(pool)
    documents = new PostgresDocumentRepository(pool)
    queue = new PostgresJobQueue(pool)
  })

  afterAll(async () => {
    for (const sessionId of sessionIds) {
      await pool.query(`DELETE FROM jobs WHERE payload->>'sessionId' = $1`, [
        sessionId.toString(),
      ])
      await sessions.delete(sessionId)
    }
    await pool.end()
    await rm(storageDir, { recursive: true, force: true })
  })

  async function newSession(): Promise<SessionId> {
    const session = createSession()
    await sessions.save(session)
    sessionIds.push(session.id)

    return session.id
  }

  it('guarda el PDF fuera de Postgres y el job apunta al archivo real', async () => {
    const sessionId = await newSession()

    const output = await uploadDocument(sessionId, PDF, {
      documentRepository: documents,
      jobQueue: queue,
      pdfFileStore: store,
    })

    const job = await queue.getJob(output.jobId)
    const storagePath = job?.payload.storagePath

    expect(output.documentStatus).toBe('pending')
    expect(typeof storagePath).toBe('string')
    expect(await readdir(storageDir)).toContain(storagePath)
    expect(JSON.stringify(job?.payload)).not.toContain('pdfBase64')
  })

  it('sanea el nombre original antes de persistirlo', async () => {
    const sessionId = await newSession()

    const output = await uploadDocument(sessionId, PDF, {
      documentRepository: documents,
      jobQueue: queue,
      pdfFileStore: store,
      displayName: 'C:\\private\\..\\factura\u0000.pdf',
    })
    const document = await documents.findById(
      sessionId,
      DocumentId.create(output.documentId)
    )

    expect(document?.id.equals(DocumentId.create(output.documentId))).toBe(
      true
    )
    expect(document?.displayName).toBe('factura.pdf')
  })

  it('rechaza la sexta subida de la sesión', async () => {
    const sessionId = await newSession()

    for (let i = 0; i < MAX_DOCUMENTS_PER_SESSION; i += 1) {
      await uploadDocument(sessionId, PDF, {
        documentRepository: documents,
        jobQueue: queue,
        pdfFileStore: store,
      })
    }

    await expect(
      uploadDocument(sessionId, PDF, {
        documentRepository: documents,
        jobQueue: queue,
        pdfFileStore: store,
      })
    ).rejects.toBeInstanceOf(DocumentQuotaExceededError)
  })
})
