export const INGEST_DOCUMENT_JOB_TYPE = 'ingest_document'

export type JobStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface IngestDocumentJobPayload {
  readonly documentId: string
  readonly sessionId: string
  readonly pdfOriginalName: string
  readonly pdfByteLength: number
  readonly pdfBase64: string
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
  submitIngestJob(
    documentId: string,
    sessionId: string,
    pdfBytes: Buffer,
    pdfOriginalName: string
  ): Promise<Job>

  getJob(id: string): Promise<Job | null>

  claimNextJob(): Promise<Job | null>

  markReady(id: string, result: Record<string, unknown>): Promise<void>

  markFailed(id: string, error: string): Promise<void>
}
