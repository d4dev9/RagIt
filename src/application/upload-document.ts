import { randomUUID } from 'node:crypto'
import type { Buffer } from 'node:buffer'
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
import type {
  DocumentRecord,
  DocumentRepository,
} from '../ports/documents/document-repository'
import type { JobQueue } from '../ports/job-queue'
import type { PdfFileStore } from '../ports/pdf-file-store'

export interface UploadDependencies {
  readonly documentRepository: DocumentRepository
  readonly jobQueue: JobQueue
  readonly pdfFileStore: PdfFileStore
}

export interface UploadDocumentOutput {
  readonly documentId: string
  readonly jobId: string
  readonly documentStatus: DocumentStatus
}

export async function uploadDocument(
  sessionId: SessionId,
  pdfBytes: Buffer,
  deps: UploadDependencies
): Promise<UploadDocumentOutput> {
  const content = new Uint8Array(pdfBytes)

  assertPdfSignature(content)
  assertPdfSize(content)
  assertDocumentQuota(await deps.documentRepository.countBySession(sessionId))

  const documentId = DocumentId.create(randomUUID())
  const now = new Date()
  const record: DocumentRecord = {
    id: documentId,
    status: DocumentState.pending().status,
    sizeBytes: pdfBytes.byteLength,
    pageCount: 0,
    createdAt: now,
    updatedAt: now,
  }

  const stored = await deps.documentRepository.saveIfBelowQuota(
    sessionId,
    record,
    MAX_DOCUMENTS_PER_SESSION
  )

  if (!stored) {
    throw new DocumentQuotaExceededError()
  }

  let storagePath: string

  try {
    storagePath = await deps.pdfFileStore.save(pdfBytes)
  } catch (error) {
    await markFailed(deps.documentRepository, sessionId, documentId)
    throw error
  }

  try {
    const job = await deps.jobQueue.submitIngestJob({
      documentId: documentId.toString(),
      sessionId: sessionId.toString(),
      storagePath,
      pdfByteLength: pdfBytes.byteLength,
    })

    return {
      documentId: documentId.toString(),
      jobId: job.id,
      documentStatus: record.status,
    }
  } catch (error) {
    await deps.pdfFileStore.remove(storagePath)
    await markFailed(deps.documentRepository, sessionId, documentId)
    throw error
  }
}

async function markFailed(
  documentRepository: DocumentRepository,
  sessionId: SessionId,
  documentId: DocumentId
): Promise<void> {
  const failed = DocumentState.pending().transitionTo('failed').status

  await documentRepository.updateStatus(sessionId, documentId, failed, new Date())
}
