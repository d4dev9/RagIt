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
  readonly embeddingModel: string | null
  readonly createdAt: Date
}

export interface ReindexChunk {
  readonly id: ChunkId
  readonly content: string
}

export interface ChunkMatch extends ChunkRecord {
  readonly displayName: string
  readonly distance: number
}

export interface ChunkRepository {
  saveMany(
    sessionId: SessionId,
    documentId: DocumentId,
    chunks: readonly ChunkInput[],
    embeddingModel: string
  ): Promise<void>
  listByDocument(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<readonly ChunkRecord[]>
  searchBySession(
    sessionId: SessionId,
    embedding: readonly number[],
    limit: number,
    embeddingModel: string
  ): Promise<readonly ChunkMatch[]>
  listForReindex(
    afterId: ChunkId | null,
    limit: number,
    sessionId?: SessionId
  ): Promise<readonly ReindexChunk[]>
  updateEmbedding(
    chunkId: ChunkId,
    embedding: readonly number[],
    embeddingModel: string
  ): Promise<void>
  deleteByDocument(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<number>
}
