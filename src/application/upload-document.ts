import { randomUUID } from 'node:crypto'
import { DocumentId } from '../domain/documents/document-id'
import { DocumentState } from '../domain/documents/document-status'
import type { DocumentStatus } from '../domain/documents/document-status'
import {
  assertDocumentQuota,
  assertPdfSize,
  MAX_DOCUMENTS_PER_SESSION,
} from '../domain/documents/document-limits'
import { DocumentQuotaExceededError } from '../domain/documents/document-errors'
import { assertPdfSignature } from '../domain/documents/pdf-signature'
import type { SessionId } from '../domain/sessions/session-id'
import type { DocumentRecord } from '../ports/documents/document-repository'
import type { DocumentRepository } from '../ports/documents/document-repository'
import type { JobQueue } from '../ports/job-queue'

export interface UploadDocumentInput {
  readonly pdfBytes: Buffer
  readonly pdfOriginalName?: string
}

export interface UploadDocumentOutput {
  readonly documentId: string
  readonly jobId: string
  readonly documentStatus: DocumentStatus
}

export async function uploadDocument(
  sessionId: SessionId,
  pdfBytes: Buffer,
  documentRepository: DocumentRepository,
  jobQueue: JobQueue,
  pdfOriginalName?: string
): Promise<UploadDocumentOutput> {
  const pdfUint8 = new Uint8Array(pdfBytes)

  assertPdfSignature(pdfUint8)
  assertPdfSize(pdfUint8)

  const currentCount = await documentRepository.countBySession(sessionId)

  assertDocumentQuota(currentCount)

  const documentId = DocumentId.create(randomUUID())
  const now = new Date()
  const documentRecord: DocumentRecord = {
    id: documentId,
    status: DocumentState.pending().status,
    sizeBytes: pdfBytes.byteLength,
    pageCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  const stored = await documentRepository.saveIfBelowQuota(
    sessionId,
    documentRecord,
    MAX_DOCUMENTS_PER_SESSION
  )

  if (!stored) {
    throw new DocumentQuotaExceededError()
  }

  try {
    const job = await jobQueue.submitIngestJob(
      documentId.toString(),
      sessionId.toString(),
      pdfBytes,
      pdfOriginalName ?? ''
    )

    return {
      documentId: documentId.toString(),
      jobId: job.id,
      documentStatus: documentRecord.status,
    }
  } catch (error) {
    await documentRepository.delete(sessionId, documentId)
    throw error
  }
}
