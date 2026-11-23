import { randomUUID } from 'node:crypto'
import type { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentId } from '../../../src/domain/documents/document-id'
import type { DocumentStatus } from '../../../src/domain/documents/document-status'
import { EMBEDDING_DIMENSIONS } from '../../../src/domain/documents/embedding'
import type { SessionId } from '../../../src/domain/sessions/session-id'
import type {
  ChunkInput,
  ChunkRecord,
  ChunkRepository,
} from '../../../src/ports/documents/chunk-repository'
import type {
  DocumentRecord,
  DocumentRepository,
} from '../../../src/ports/documents/document-repository'
import type { EmbeddingProvider } from '../../../src/ports/embedding-provider'
import type {
  IngestDocumentJobPayload,
  Job,
  JobQueue,
} from '../../../src/ports/job-queue'
import type { IngestionFailureCode } from '../../../src/domain/documents/ingestion-failure'
import type { PdfFileStore } from '../../../src/ports/pdf-file-store'
import { ChunkId } from '../../../src/domain/documents/chunk-id'

export function fixture(name: string): Buffer {
  return readFileSync(resolve('tests/fixtures/ocr', name))
}

export function newDocumentRecord(status: DocumentStatus = 'pending'): DocumentRecord {
  const now = new Date()

  return {
    id: DocumentId.create(randomUUID()),
    status,
    storagePath: `${randomUUID()}.pdf`,
    displayName: 'documento.pdf',
    sizeBytes: 1024,
    pageCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export class MemoryDocumentRepository implements DocumentRepository {
  readonly entries = new Map<string, { sessionId: string; record: DocumentRecord }>()

  async save(sessionId: SessionId, document: DocumentRecord): Promise<void> {
    this.entries.set(document.id.toString(), {
      sessionId: sessionId.toString(),
      record: document,
    })
  }

  async saveIfBelowQuota(
    sessionId: SessionId,
    document: DocumentRecord,
    maxDocuments: number
  ): Promise<boolean> {
    if ((await this.countBySession(sessionId)) >= maxDocuments) {
      return false
    }

    await this.save(sessionId, document)

    return true
  }

  async findById(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<DocumentRecord | null> {
    const entry = this.entries.get(documentId.toString())

    if (!entry || entry.sessionId !== sessionId.toString()) {
      return null
    }

    return entry.record
  }

  async listBySession(sessionId: SessionId): Promise<readonly DocumentRecord[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.sessionId === sessionId.toString())
      .map((entry) => entry.record)
  }

  async updateStatus(
    sessionId: SessionId,
    documentId: DocumentId,
    status: DocumentStatus,
    updatedAt: Date
  ): Promise<boolean> {
    const key = documentId.toString()
    const entry = this.entries.get(key)

    if (!entry || entry.sessionId !== sessionId.toString()) {
      return false
    }

    this.entries.set(key, {
      sessionId: entry.sessionId,
      record: { ...entry.record, status, updatedAt },
    })

    return true
  }

  async countBySession(sessionId: SessionId): Promise<number> {
    return (await this.listBySession(sessionId)).length
  }

  async delete(sessionId: SessionId, documentId: DocumentId): Promise<boolean> {
    const key = documentId.toString()
    const entry = this.entries.get(key)

    if (!entry || entry.sessionId !== sessionId.toString()) {
      return false
    }

    return this.entries.delete(key)
  }

  statusOf(documentId: string): DocumentStatus | undefined {
    return this.entries.get(documentId)?.record.status
  }
}

export class MemoryChunkRepository implements ChunkRepository {
  readonly rows: ChunkRecord[] = []

  async saveMany(
    _sessionId: SessionId,
    documentId: DocumentId,
    chunks: readonly ChunkInput[],
    embeddingModel: string
  ): Promise<void> {
    for (const chunk of chunks) {
      this.rows.push({
        id: chunk.id,
        documentId,
        page: chunk.page,
        index: chunk.index,
        content: chunk.content,
        embedding: chunk.embedding,
        embeddingModel,
        createdAt: new Date(),
      })
    }
  }

  async listByDocument(
    _sessionId: SessionId,
    documentId: DocumentId
  ): Promise<readonly ChunkRecord[]> {
    return this.rows.filter((row) => row.documentId.toString() === documentId.toString())
  }

  async searchBySession(): Promise<never[]> {
    return []
  }

  async listForReindex(
    afterId: ChunkId | null,
    limit: number
  ): Promise<readonly { id: ChunkId; content: string }[]> {
    const sorted = [...this.rows].sort((left, right) =>
      left.id.toString().localeCompare(right.id.toString())
    )
    const afterIndex = afterId
      ? sorted.findIndex((chunk) => chunk.id.equals(afterId))
      : -1

    return sorted
      .slice(afterIndex + 1)
      .slice(0, limit)
      .map(({ id, content }) => ({ id, content }))
  }

  async updateEmbedding(
    chunkId: ChunkId,
    embedding: readonly number[],
    embeddingModel: string
  ): Promise<void> {
    const chunk = this.rows.find((row) => row.id.equals(chunkId))

    if (chunk) {
      const index = this.rows.indexOf(chunk)
      this.rows[index] = { ...chunk, embedding, embeddingModel }
    }
  }

  async deleteByDocument(
    _sessionId: SessionId,
    documentId: DocumentId
  ): Promise<number> {
    const before = this.rows.length
    const kept = this.rows.filter((row) => row.documentId.toString() !== documentId.toString())

    this.rows.splice(0, this.rows.length, ...kept)

    return before - kept.length
  }
}

export class MemoryPdfFileStore implements PdfFileStore {
  readonly files = new Map<string, Buffer>()

  async save(bytes: Buffer): Promise<string> {
    const name = `${randomUUID()}.pdf`

    this.files.set(name, bytes)

    return name
  }

  async read(storagePath: string): Promise<Buffer> {
    const bytes = this.files.get(storagePath)

    if (!bytes) {
      throw new Error('archivo no encontrado')
    }

    return bytes
  }

  async remove(storagePath: string): Promise<void> {
    this.files.delete(storagePath)
  }
}

export class MemoryJobQueue implements JobQueue {
  readonly jobs = new Map<string, Job>()
  readonly submitted: IngestDocumentJobPayload[] = []

  async submitIngestJob(payload: IngestDocumentJobPayload): Promise<Job> {
    this.submitted.push(payload)

    const job: Job = {
      id: randomUUID(),
      type: 'ingest_document',
      payload: { ...payload },
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
    }

    this.jobs.set(job.id, job)

    return job
  }

  async getJob(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null
  }

  async claimNextJob(): Promise<Job | null> {
    const next = [...this.jobs.values()].find((job) => job.status === 'pending')

    if (!next) {
      return null
    }

    const claimed: Job = { ...next, status: 'processing', attempts: next.attempts + 1 }

    this.jobs.set(next.id, claimed)

    return claimed
  }

  async markReady(id: string, result: Record<string, unknown>): Promise<void> {
    this.finish(id, 'ready', { result })
  }

  async markFailed(id: string, error: IngestionFailureCode): Promise<void> {
    this.finish(id, 'failed', { error })
  }

  async deleteByDocument(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<void> {
    for (const [id, job] of this.jobs) {
      if (
        job.payload.sessionId === sessionId.toString() &&
        job.payload.documentId === documentId.toString()
      ) {
        this.jobs.delete(id)
      }
    }
  }

  async deleteBySession(sessionId: SessionId): Promise<void> {
    for (const [id, job] of this.jobs) {
      if (job.payload.sessionId === sessionId.toString()) {
        this.jobs.delete(id)
      }
    }
  }

  statusOf(id: string): string | undefined {
    return this.jobs.get(id)?.status
  }

  private finish(
    id: string,
    status: 'ready' | 'failed',
    extra: { result?: Record<string, unknown>; error?: string }
  ): void {
    const job = this.jobs.get(id)

    if (!job) {
      return
    }

    this.jobs.set(id, { ...job, status, completedAt: new Date(), ...extra })
  }
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = 'test-embedding-model'
  calls = 0

  constructor(private readonly behavior: 'ok' | 'fail' | 'short' = 'ok') {}

  async embed(texts: string[]): Promise<number[][]> {
    this.calls += 1

    if (this.behavior === 'fail') {
      throw new Error('proveedor no disponible')
    }

    const count = this.behavior === 'short' ? Math.max(0, texts.length - 1) : texts.length

    return Array.from({ length: count }, () =>
      Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01)
    )
  }
}

export function newChunkId(): ChunkId {
  return ChunkId.create(randomUUID())
}
