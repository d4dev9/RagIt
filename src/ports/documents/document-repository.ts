import type { DocumentId } from '../../domain/documents/document-id'
import type { DocumentStatus } from '../../domain/documents/document-status'
import type { SessionId } from '../../domain/sessions/session-id'

export interface DocumentRecord {
  readonly id: DocumentId
  readonly status: DocumentStatus
  readonly sizeBytes: number
  readonly pageCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface DocumentRepository {
  save(sessionId: SessionId, document: DocumentRecord): Promise<void>
  saveIfBelowQuota(
    sessionId: SessionId,
    document: DocumentRecord,
    maxDocuments: number
  ): Promise<boolean>
  findById(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<DocumentRecord | null>
  listBySession(sessionId: SessionId): Promise<readonly DocumentRecord[]>
  updateStatus(
    sessionId: SessionId,
    documentId: DocumentId,
    status: DocumentStatus,
    updatedAt: Date
  ): Promise<boolean>
  countBySession(sessionId: SessionId): Promise<number>
  delete(sessionId: SessionId, documentId: DocumentId): Promise<boolean>
}
