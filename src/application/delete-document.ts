import { DocumentId } from '../domain/documents/document-id'
import type { SessionId } from '../domain/sessions/session-id'
import type { ChunkRepository } from '../ports/documents/chunk-repository'
import type { DocumentRepository } from '../ports/documents/document-repository'
import type { JobQueue } from '../ports/job-queue'
import type { PdfFileStore } from '../ports/pdf-file-store'

export interface DeleteDocumentDependencies {
  readonly documentRepository: DocumentRepository
  readonly chunkRepository: ChunkRepository
  readonly jobQueue: JobQueue
  readonly pdfFileStore: PdfFileStore
}

export async function deleteDocument(
  sessionId: SessionId,
  documentIdValue: string,
  deps: DeleteDocumentDependencies
): Promise<boolean> {
  const documentId = DocumentId.create(documentIdValue)
  const document = await deps.documentRepository.findById(sessionId, documentId)

  if (!document) {
    return false
  }

  await deps.chunkRepository.deleteByDocument(sessionId, documentId)
  await deps.jobQueue.deleteByDocument(sessionId, documentId)
  if (document.storagePath) {
    await deps.pdfFileStore.remove(document.storagePath)
  }

  return deps.documentRepository.delete(sessionId, documentId)
}
