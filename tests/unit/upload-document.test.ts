import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { uploadDocument } from '../../src/application/upload-document'
import {
  DocumentQuotaExceededError,
  InvalidPdfSignatureError,
} from '../../src/domain/documents/document-errors'
import { DocumentId } from '../../src/domain/documents/document-id'
import { MAX_DOCUMENTS_PER_SESSION } from '../../src/domain/documents/document-limits'
import { SessionId } from '../../src/domain/sessions/session-id'
import type { DocumentRecord } from '../../src/ports/documents/document-repository'
import type { DocumentRepository } from '../../src/ports/documents/document-repository'
import type { Job, JobQueue } from '../../src/ports/job-queue'

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')

class InMemoryDocumentRepository implements DocumentRepository {
  readonly documents = new Map<string, DocumentRecord>()
  private readonly sessionHints = new Map<string, string>()

  async save(sessionId: SessionId, document: DocumentRecord): Promise<void> {
    this.documents.set(document.id.toString(), document)
    this.sessionHints.set(document.id.toString(), sessionId.toString())
  }

  async saveIfBelowQuota(
    sessionId: SessionId,
    document: DocumentRecord,
    maxDocuments: number
  ): Promise<boolean> {
    const current = await this.countBySession(sessionId)

    if (current >= maxDocuments) {
      return false
    }

    await this.save(sessionId, document)

    return true
  }

  async findById(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<DocumentRecord | null> {
    if (this.sessionHints.get(documentId.toString()) !== sessionId.toString()) {
      return null
    }

    return this.documents.get(documentId.toString()) ?? null
  }

  async listBySession(
    sessionId: SessionId
  ): Promise<readonly DocumentRecord[]> {
    return [...this.documents.values()].filter(
      (document) =>
        this.sessionHints.get(document.id.toString()) === sessionId.toString()
    )
  }

  async updateStatus(
    _sessionId: SessionId,
    documentId: DocumentId,
    status: DocumentRecord['status'],
    updatedAt: Date
  ): Promise<boolean> {
    const existing = this.documents.get(documentId.toString())

    if (!existing) {
      return false
    }

    this.documents.set(documentId.toString(), {
      ...existing,
      status,
      updatedAt,
    })

    return true
  }

  async countBySession(sessionId: SessionId): Promise<number> {
    const documents = await this.listBySession(sessionId)

    return documents.length
  }

  async delete(sessionId: SessionId, documentId: DocumentId): Promise<boolean> {
    const existing = await this.findById(sessionId, documentId)

    if (!existing) {
      return false
    }

    this.documents.delete(documentId.toString())
    this.sessionHints.delete(documentId.toString())

    return true
  }

  seed(sessionId: SessionId, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const document: DocumentRecord = {
        id: DocumentId.create(randomUUID()),
        status: 'pending',
        sizeBytes: PDF_BYTES.byteLength,
        pageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      this.documents.set(document.id.toString(), document)
      this.sessionHints.set(document.id.toString(), sessionId.toString())
    }
  }
}

class RecordingJobQueue implements JobQueue {
  readonly submitted: Array<{
    readonly documentId: string
    readonly sessionId: string
    readonly pdfBytes: Buffer
    readonly pdfOriginalName: string
  }> = []
  shouldFail = false

  async submitIngestJob(
    documentId: string,
    sessionId: string,
    pdfBytes: Buffer,
    pdfOriginalName: string
  ): Promise<Job> {
    if (this.shouldFail) {
      throw new Error('job queue unavailable')
    }

    this.submitted.push({ documentId, sessionId, pdfBytes, pdfOriginalName })

    return {
      id: randomUUID(),
      type: 'ingest_document',
      payload: {},
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
    }
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

function newSessionId(): SessionId {
  return SessionId.create(randomUUID())
}

describe('uploadDocument (F-02, F-04)', () => {
  it('guarda el documento pendiente y encola el PDF real', async () => {
    const repository = new InMemoryDocumentRepository()
    const queue = new RecordingJobQueue()
    const sessionId = newSessionId()
    const result = await uploadDocument(
      sessionId,
      PDF_BYTES,
      repository,
      queue,
      'factura.pdf'
    )
    const stored = await repository.findById(
      sessionId,
      DocumentId.create(result.documentId)
    )

    expect(stored?.status).toBe('pending')
    expect(stored?.pageCount).toBe(0)
    expect(result.documentStatus).toBe('pending')
    expect(queue.submitted).toHaveLength(1)
    expect(queue.submitted[0]?.pdfBytes.equals(PDF_BYTES)).toBe(true)
    expect(queue.submitted[0]?.pdfOriginalName).toBe('factura.pdf')
  })

  it('rechaza la subida cuando la sesión alcanza la cuota del dominio', async () => {
    const repository = new InMemoryDocumentRepository()
    const queue = new RecordingJobQueue()
    const sessionId = newSessionId()
    repository.seed(sessionId, MAX_DOCUMENTS_PER_SESSION)

    await expect(
      uploadDocument(sessionId, PDF_BYTES, repository, queue)
    ).rejects.toThrow(DocumentQuotaExceededError)
    expect(queue.submitted).toHaveLength(0)
  })

  it('elimina el documento si el encolado falla', async () => {
    const repository = new InMemoryDocumentRepository()
    const queue = new RecordingJobQueue()
    const sessionId = newSessionId()
    queue.shouldFail = true

    await expect(
      uploadDocument(sessionId, PDF_BYTES, repository, queue)
    ).rejects.toThrow('job queue unavailable')
    expect(await repository.countBySession(sessionId)).toBe(0)
  })

  it('rechaza un archivo sin firma PDF', async () => {
    const repository = new InMemoryDocumentRepository()
    const queue = new RecordingJobQueue()

    await expect(
      uploadDocument(
        newSessionId(),
        Buffer.from('no es un pdf'),
        repository,
        queue
      )
    ).rejects.toThrow(InvalidPdfSignatureError)
  })
})
