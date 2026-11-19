import { randomUUID } from 'node:crypto'
import { ChunkId } from '../domain/documents/chunk-id'
import { DocumentId } from '../domain/documents/document-id'
import { DocumentState } from '../domain/documents/document-status'
import type { DocumentStatus } from '../domain/documents/document-status'
import { assertEmbedding } from '../domain/documents/embedding'
import { InvalidEmbeddingError } from '../domain/documents/document-errors'
import { SessionId } from '../domain/sessions/session-id'
import { splitTextIntoChunks } from '../domain/documents/text-chunking'
import type { IngestDocumentJobPayload, Job } from '../ports/job-queue'
import type { DocumentRepository } from '../ports/documents/document-repository'
import type {
  ChunkInput,
  ChunkRepository,
} from '../ports/documents/chunk-repository'
import type { EmbeddingProvider } from '../ports/embedding-provider'
import {
  IngestDocumentNotFoundError,
  InvalidIngestJobPayloadError,
} from './ingest-errors'
import { extractText } from './extract-text'

export interface ProcessJobResult {
  readonly documentStatus: DocumentStatus
  readonly chunksSaved: number
  readonly error?: string
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]

  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidIngestJobPayloadError()
  }

  return value
}

function readPayload(job: Job): IngestDocumentJobPayload {
  const pdfByteLength = job.payload.pdfByteLength

  if (typeof pdfByteLength !== 'number' || !Number.isInteger(pdfByteLength)) {
    throw new InvalidIngestJobPayloadError()
  }

  return {
    documentId: readString(job.payload, 'documentId'),
    sessionId: readString(job.payload, 'sessionId'),
    pdfOriginalName: readString(job.payload, 'pdfOriginalName'),
    pdfByteLength,
    pdfBase64: readString(job.payload, 'pdfBase64'),
  }
}

async function failProcessing(
  documentRepository: DocumentRepository,
  sessionId: SessionId,
  documentId: DocumentId,
  error: string
): Promise<ProcessJobResult> {
  const failedStatus =
    DocumentState.from('processing').transitionTo('failed').status

  await documentRepository.updateStatus(
    sessionId,
    documentId,
    failedStatus,
    new Date()
  )

  return { documentStatus: failedStatus, chunksSaved: 0, error }
}

export async function processJob(
  job: Job,
  documentRepository: DocumentRepository,
  chunkRepository: ChunkRepository,
  embeddingProvider: EmbeddingProvider
): Promise<ProcessJobResult> {
  const payload = readPayload(job)
  const sessionId = SessionId.create(payload.sessionId)
  const documentId = DocumentId.create(payload.documentId)
  const document = await documentRepository.findById(sessionId, documentId)

  if (!document) {
    throw new IngestDocumentNotFoundError()
  }

  const currentState = DocumentState.from(document.status)

  if (currentState.isTerminal()) {
    return {
      documentStatus: currentState.status,
      chunksSaved: 0,
      error: 'El documento ya está en un estado terminal',
    }
  }

  if (currentState.status === 'pending') {
    const processingStatus = currentState.transitionTo('processing').status
    const updated = await documentRepository.updateStatus(
      sessionId,
      documentId,
      processingStatus,
      new Date()
    )

    if (!updated) {
      throw new IngestDocumentNotFoundError()
    }
  }

  const pdfBytes = Buffer.from(payload.pdfBase64, 'base64')

  if (pdfBytes.byteLength !== payload.pdfByteLength) {
    throw new InvalidIngestJobPayloadError()
  }

  const { segments } = extractText(pdfBytes)

  if (segments.length === 0) {
    return failProcessing(
      documentRepository,
      sessionId,
      documentId,
      'No se pudo extraer texto del PDF'
    )
  }

  const textChunks = segments.flatMap((segment, blockIndex) =>
    splitTextIntoChunks(segment, {
      documentId: payload.documentId,
      sessionId: payload.sessionId,
      page: blockIndex + 1,
    })
  )

  if (textChunks.length === 0) {
    return failProcessing(
      documentRepository,
      sessionId,
      documentId,
      'No se generaron fragmentos de texto'
    )
  }

  const embeddings = await embeddingProvider.embed(
    textChunks.map((chunk) => chunk.content)
  )

  if (embeddings.length !== textChunks.length) {
    throw new InvalidEmbeddingError()
  }

  const chunks: ChunkInput[] = textChunks.map((chunk, position) => {
    const embedding = embeddings[position]

    if (!embedding) {
      throw new InvalidEmbeddingError()
    }

    assertEmbedding(embedding)

    return {
      id: ChunkId.create(randomUUID()),
      page: chunk.page,
      index: chunk.index,
      content: chunk.content,
      embedding,
    }
  })

  await chunkRepository.saveMany(sessionId, documentId, chunks)

  const readyStatus =
    DocumentState.from('processing').transitionTo('ready').status
  await documentRepository.updateStatus(
    sessionId,
    documentId,
    readyStatus,
    new Date()
  )

  return {
    documentStatus: readyStatus,
    chunksSaved: chunks.length,
  }
}
