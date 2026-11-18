import type { ChunkId } from '../../domain/documents/chunk-id'
import type { DocumentId } from '../../domain/documents/document-id'
import type { SessionId } from '../../domain/sessions/session-id'

export interface ChunkInput {
  readonly id: ChunkId
  readonly page: number
  readonly index: number
  readonly content: string
  readonly embedding: readonly number[]
}

export interface ChunkRecord {
  readonly id: ChunkId
  readonly documentId: DocumentId
  readonly page: number
  readonly index: number
  readonly content: string
  readonly embedding: readonly number[]
  readonly createdAt: Date
}

export interface ChunkMatch extends ChunkRecord {
  readonly distance: number
}

export interface ChunkRepository {
  saveMany(
    sessionId: SessionId,
    documentId: DocumentId,
    chunks: readonly ChunkInput[]
  ): Promise<void>
  listByDocument(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<readonly ChunkRecord[]>
  searchBySession(
    sessionId: SessionId,
    embedding: readonly number[],
    limit: number
  ): Promise<readonly ChunkMatch[]>
  deleteByDocument(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<number>
}
