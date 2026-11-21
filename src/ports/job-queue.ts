import type { DocumentId } from '../domain/documents/document-id'
import type { SessionId } from '../domain/sessions/session-id'

export const INGEST_DOCUMENT_JOB_TYPE = 'ingest_document'

export type JobStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface IngestDocumentJobPayload {
  readonly documentId: string
  readonly sessionId: string
  readonly storagePath: string
  readonly pdfByteLength: number
}

export interface Job {
  readonly id: string
  readonly type: 'ingest_document'
  readonly payload: Record<string, unknown>
  readonly status: JobStatus
  readonly attempts: number
  readonly createdAt: Date
  readonly startedAt?: Date
  readonly completedAt?: Date
  readonly result?: Record<string, unknown>
  readonly error?: string
}

export interface JobQueue {
  submitIngestJob(payload: IngestDocumentJobPayload): Promise<Job>
  getJob(id: string): Promise<Job | null>
  claimNextJob(): Promise<Job | null>
  markReady(id: string, result: Record<string, unknown>): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  deleteByDocument(sessionId: SessionId, documentId: DocumentId): Promise<void>
  deleteBySession(sessionId: SessionId): Promise<void>
}
