import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { InvalidIngestJobPayloadError } from '../../src/application/ingest-errors'
import { processJob } from '../../src/application/process-job'
import { InvalidEmbeddingError } from '../../src/domain/documents/document-errors'
import { DocumentId } from '../../src/domain/documents/document-id'
import type { DocumentStatus } from '../../src/domain/documents/document-status'
import type { SessionId } from '../../src/domain/sessions/session-id'
import { SessionId as SessionIdValue } from '../../src/domain/sessions/session-id'
import type { EmbeddingProvider } from '../../src/ports/embedding-provider'
import type {
  ChunkInput,
  ChunkMatch,
  ChunkRecord,
} from '../../src/ports/documents/chunk-repository'
import type { ChunkRepository } from '../../src/ports/documents/chunk-repository'
import type { DocumentRecord } from '../../src/ports/documents/document-repository'
import type { DocumentRepository } from '../../src/ports/documents/document-repository'
import type { Job } from '../../src/ports/job-queue'

function buildPdf(blocks: readonly string[]): Buffer {
  const body = blocks.map((block) => `BT\n(${block}) Tj\nET\n`).join('')

  return Buffer.from(`%PDF-1.4\n${body}%%EOF`)
}

class FakeDocumentRepository implements DocumentRepository {
  readonly statuses: DocumentStatus[] = []
  private record: DocumentRecord

  constructor(record: DocumentRecord) {
    this.record = record
  }

  async save(_sessionId: SessionId, document: DocumentRecord): Promise<void> {
    this.record = document
  }

  async saveIfBelowQuota(
    _sessionId: SessionId,
    document: DocumentRecord
  ): Promise<boolean> {
    this.record = document

    return true
  }

  async findById(
    _sessionId: SessionId,
    documentId: DocumentId
  ): Promise<DocumentRecord | null> {
    if (!this.record.id.equals(documentId)) {
      return null
    }

    return this.record
  }

  async listBySession(): Promise<readonly DocumentRecord[]> {
    return [this.record]
  }

  async updateStatus(
    _sessionId: SessionId,
    _documentId: DocumentId,
    status: DocumentStatus,
    updatedAt: Date
  ): Promise<boolean> {
    this.statuses.push(status)
    this.record = { ...this.record, status, updatedAt }

    return true
  }

  async countBySession(): Promise<number> {
    return 1
  }

  async delete(): Promise<boolean> {
    return true
  }
}

class FakeChunkRepository implements ChunkRepository {
  saved: readonly ChunkInput[] = []

  async saveMany(
    _sessionId: SessionId,
    _documentId: DocumentId,
    chunks: readonly ChunkInput[]
  ): Promise<void> {
    this.saved = chunks
  }

  async listByDocument(): Promise<readonly ChunkRecord[]> {
    return []
  }

  async searchBySession(): Promise<readonly ChunkMatch[]> {
    return []
  }

  async deleteByDocument(): Promise<number> {
    return 0
  }
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  received: readonly string[] = []
  vectorCountOffset = 0

  async embed(texts: string[]): Promise<number[][]> {
    this.received = texts

    return texts.slice(0, texts.length + this.vectorCountOffset).map((text) => {
      const vector = Array.from({ length: 768 }, () => 0)
      const hash = [...text].reduce(
        (total, symbol) => total + symbol.charCodeAt(0),
        0
      )

      vector[0] = hash

      return vector
    })
  }
}

function newDocument(): DocumentRecord {
  const now = new Date()

  return {
    id: DocumentId.create(randomUUID()),
    status: 'pending',
    sizeBytes: 64,
    pageCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function newSessionId(): SessionId {
  return SessionIdValue.create(randomUUID())
}

function createJobFor(document: DocumentRecord, pdfBytes: Buffer): Job {
  return {
    id: randomUUID(),
    type: 'ingest_document',
    payload: {
      documentId: document.id.toString(),
      sessionId: newSessionId().toString(),
      pdfOriginalName: 'documento.pdf',
      pdfByteLength: pdfBytes.byteLength,
      pdfBase64: pdfBytes.toString('base64'),
    },
    status: 'pending',
    attempts: 1,
    createdAt: new Date(),
  }
}

describe('processJob (F-03, F-04)', () => {
  it('transita pending a processing y ready, y guarda fragmentos', async () => {
    const document = newDocument()
    const pdfBytes = buildPdf(['contenido uno', 'contenido dos'])
    const job = createJobFor(document, pdfBytes)
    const documents = new FakeDocumentRepository(document)
    const chunks = new FakeChunkRepository()
    const provider = new FakeEmbeddingProvider()

    const result = await processJob(job, documents, chunks, provider)

    expect(documents.statuses).toEqual(['processing', 'ready'])
    expect(result.documentStatus).toBe('ready')
    expect(result.chunksSaved).toBe(2)
    expect(provider.received).toEqual(['contenido uno', 'contenido dos'])
    expect(chunks.saved.map((chunk) => chunk.page)).toEqual([1, 2])
    expect(chunks.saved.map((chunk) => chunk.index)).toEqual([0, 0])
    expect(chunks.saved[0]?.embedding).not.toEqual(chunks.saved[1]?.embedding)
  })

  it('reinicia el índice por página y respeta el máximo de 800 caracteres', async () => {
    const document = newDocument()
    const longText = 'a'.repeat(1700)
    const pdfBytes = buildPdf([longText])
    const job = createJobFor(document, pdfBytes)
    const documents = new FakeDocumentRepository(document)
    const chunks = new FakeChunkRepository()
    const provider = new FakeEmbeddingProvider()

    const result = await processJob(job, documents, chunks, provider)

    expect(result.chunksSaved).toBe(3)
    expect(chunks.saved.map((chunk) => chunk.index)).toEqual([0, 1, 2])
    expect(chunks.saved.map((chunk) => chunk.content.length)).toEqual([
      800, 800, 300,
    ])
    expect(chunks.saved.every((chunk) => chunk.content.length <= 800)).toBe(
      true
    )
  })

  it('marca el documento como failed cuando no hay texto extraíble', async () => {
    const document = newDocument()
    const pdfBytes = Buffer.from('%PDF-1.4\n%%EOF')
    const job = createJobFor(document, pdfBytes)
    const documents = new FakeDocumentRepository(document)
    const chunks = new FakeChunkRepository()
    const provider = new FakeEmbeddingProvider()

    const result = await processJob(job, documents, chunks, provider)

    expect(result.documentStatus).toBe('failed')
    expect(documents.statuses).toEqual(['processing', 'failed'])
    expect(provider.received).toEqual([])
  })

  it('rechaza un payload sin el PDF en base64', async () => {
    const document = newDocument()
    const job: Job = {
      id: randomUUID(),
      type: 'ingest_document',
      payload: {
        documentId: document.id.toString(),
        sessionId: newSessionId().toString(),
        pdfOriginalName: 'documento.pdf',
        pdfByteLength: 10,
      },
      status: 'pending',
      attempts: 1,
      createdAt: new Date(),
    }
    const documents = new FakeDocumentRepository(document)
    const chunks = new FakeChunkRepository()
    const provider = new FakeEmbeddingProvider()

    await expect(processJob(job, documents, chunks, provider)).rejects.toThrow(
      InvalidIngestJobPayloadError
    )
  })

  it('rechaza un número de vectores distinto al de fragmentos', async () => {
    const document = newDocument()
    const pdfBytes = buildPdf(['un bloque'])
    const job = createJobFor(document, pdfBytes)
    const documents = new FakeDocumentRepository(document)
    const chunks = new FakeChunkRepository()
    const provider = new FakeEmbeddingProvider()
    provider.vectorCountOffset = -1

    await expect(processJob(job, documents, chunks, provider)).rejects.toThrow(
      InvalidEmbeddingError
    )
  })
})
