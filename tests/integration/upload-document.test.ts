import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DocumentQuotaExceededError } from '../../src/domain/documents/document-errors'
import { MAX_DOCUMENTS_PER_SESSION } from '../../src/domain/documents/document-limits'
import { DocumentId } from '../../src/domain/documents/document-id'
import { PostgresDocumentRepository } from '../../src/infrastructure/database/postgres-document-repository'
import { PostgresSessionRepository } from '../../src/infrastructure/database/postgres-session-repository'
import type { SessionId } from '../../src/domain/sessions/session-id'
import { uploadDocument } from '../../src/application/upload-document'
import type { Job, JobQueue } from '../../src/ports/job-queue'
import {
  createAppPool,
  createSession,
  integrationEnabled,
  migrateDatabase,
} from './test-database'

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')

class InMemoryJobQueue implements JobQueue {
  readonly jobs: Job[] = []

  async submitIngestJob(
    documentId: string,
    sessionId: string,
    pdfBytes: Buffer,
    pdfOriginalName: string
  ): Promise<Job> {
    const job: Job = {
      id: randomUUID(),
      type: 'ingest_document',
      payload: {
        documentId,
        sessionId,
        pdfOriginalName,
        pdfByteLength: pdfBytes.byteLength,
      },
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
    }

    this.jobs.push(job)

    return job
  }

  async getJob(): Promise<Job | null> {
    return null
  }

  async claimNextJob(): Promise<Job | null> {
    return null
  }

  async markReady(): Promise<void> {}

  async markFailed(): Promise<void> {}
}

describe.skipIf(!integrationEnabled)('uploadDocument contra Postgres', () => {
  let pool: Pool
  let sessions: PostgresSessionRepository
  let documents: PostgresDocumentRepository
  const created: SessionId[] = []

  beforeAll(async () => {
    await migrateDatabase()
    pool = createAppPool()
    sessions = new PostgresSessionRepository(pool)
    documents = new PostgresDocumentRepository(pool)
  })

  afterAll(async () => {
    for (const sessionId of created) {
      await sessions.delete(sessionId)
    }

    await pool.end()
  })

  async function newSessionId(): Promise<SessionId> {
    const session = createSession()
    await sessions.save(session)
    created.push(session.id)

    return session.id
  }

  it('persiste el documento pendiente con pageCount 0 y encola el trabajo', async () => {
    const sessionId = await newSessionId()
    const queue = new InMemoryJobQueue()
    const result = await uploadDocument(
      sessionId,
      PDF_BYTES,
      documents,
      queue,
      'factura.pdf'
    )
    const stored = await documents.findById(
      sessionId,
      DocumentId.create(result.documentId)
    )

    expect(stored?.status).toBe('pending')
    expect(stored?.pageCount).toBe(0)
    expect(queue.jobs).toHaveLength(1)
    expect(result.jobId).toBe(queue.jobs[0]?.id)
  })

  it('aplica la cuota de documentos de forma atómica', async () => {
    const sessionId = await newSessionId()
    const queue = new InMemoryJobQueue()

    for (let index = 0; index < MAX_DOCUMENTS_PER_SESSION; index += 1) {
      await uploadDocument(sessionId, PDF_BYTES, documents, queue)
    }

    await expect(
      uploadDocument(sessionId, PDF_BYTES, documents, queue)
    ).rejects.toThrow(DocumentQuotaExceededError)
    expect(await documents.countBySession(sessionId)).toBe(
      MAX_DOCUMENTS_PER_SESSION
    )
  })
})
