import { randomUUID } from 'node:crypto'
import { ChunkId } from '../domain/documents/chunk-id'
import { DocumentId } from '../domain/documents/document-id'
import { DocumentState } from '../domain/documents/document-status'
import type { DocumentStatus } from '../domain/documents/document-status'
import { MAX_DOCUMENT_PAGES } from '../domain/documents/document-limits'
import { assertEmbedding } from '../domain/documents/embedding'
import { splitTextIntoChunks } from '../domain/documents/text-chunking'
import { SessionId } from '../domain/sessions/session-id'
import type { DocumentRepository } from '../ports/documents/document-repository'
import type {
  ChunkInput,
  ChunkRepository,
} from '../ports/documents/chunk-repository'
import type { EmbeddingProvider } from '../ports/embedding-provider'
import type {
  IngestDocumentJobPayload,
  Job,
  JobQueue,
} from '../ports/job-queue'
import type { PdfFileStore } from '../ports/pdf-file-store'
import { extractText } from './extract-text'
import {
  IngestDocumentNotFoundError,
  InvalidIngestJobPayloadError,
} from './ingest-errors'

export interface ProcessJobDependencies {
  readonly documentRepository: DocumentRepository
  readonly chunkRepository: ChunkRepository
  readonly embeddingProvider: EmbeddingProvider
  readonly pdfFileStore: PdfFileStore
  readonly jobQueue: JobQueue
}

export interface ProcessJobResult {
  readonly documentStatus: DocumentStatus
  readonly chunksSaved: number
}

export function readJobPayload(job: Job): IngestDocumentJobPayload {
  const { documentId, sessionId, storagePath, pdfByteLength } = job.payload

  if (
    typeof documentId !== 'string' ||
    typeof sessionId !== 'string' ||
    typeof storagePath !== 'string' ||
    typeof pdfByteLength !== 'number' ||
    !Number.isInteger(pdfByteLength)
  ) {
    throw new InvalidIngestJobPayloadError()
  }

  return { documentId, sessionId, storagePath, pdfByteLength }
}

export async function processJob(
  job: Job,
  deps: ProcessJobDependencies
): Promise<ProcessJobResult> {
  const payload = readJobPayload(job)
  const sessionId = SessionId.create(payload.sessionId)
  const documentId = DocumentId.create(payload.documentId)
  const document = await deps.documentRepository.findById(sessionId, documentId)

  if (!document) {
    throw new IngestDocumentNotFoundError()
  }

  const current = DocumentState.from(document.status)

  if (current.isTerminal()) {
    await deps.jobQueue.markReady(job.id, {
      documentStatus: current.status,
      chunksSaved: 0,
    })

    return { documentStatus: current.status, chunksSaved: 0 }
  }

  if (current.status === 'pending') {
    await deps.documentRepository.updateStatus(
      sessionId,
      documentId,
      current.transitionTo('processing').status,
      new Date()
    )
  }

  let pdfBytes: Buffer

  try {
    pdfBytes = await deps.pdfFileStore.read(payload.storagePath)
  } catch {
    return failJob(job, payload, deps, 'pdf_no_disponible')
  }

  if (pdfBytes.byteLength !== payload.pdfByteLength) {
    return failJob(job, payload, deps, 'tamano_no_coincide')
  }

  const { pages } = extractText(pdfBytes)

  if (pages.length > MAX_DOCUMENT_PAGES) {
    return failJob(job, payload, deps, 'limite_paginas_excedido')
  }

  const textChunks = pages.flatMap((page) => {
    const text = page.segments.join('\n')

    if (text.trim().length === 0) {
      return []
    }

    return splitTextIntoChunks(text, {
      documentId: payload.documentId,
      sessionId: payload.sessionId,
      page: page.page,
    })
  })

  if (textChunks.length === 0) {
    return failJob(job, payload, deps, 'sin_texto_extraible')
  }

  let embeddings: number[][]

  try {
    embeddings = await deps.embeddingProvider.embed(
      textChunks.map((chunk) => chunk.content)
    )
  } catch {
    return failJob(job, payload, deps, 'proveedor_embeddings')
  }

  if (embeddings.length !== textChunks.length) {
    return failJob(job, payload, deps, 'embeddings_incompletos')
  }

  const chunks: ChunkInput[] = textChunks.map((chunk, position) => {
    const embedding = embeddings[position]

    if (!embedding) {
      throw new InvalidIngestJobPayloadError('Falta un embedding para un fragmento')
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

  await deps.chunkRepository.saveMany(sessionId, documentId, chunks)

  await deps.documentRepository.updateStatus(
    sessionId,
    documentId,
    DocumentState.from('processing').transitionTo('ready').status,
    new Date()
  )

  await deps.pdfFileStore.remove(payload.storagePath)
  await deps.jobQueue.markReady(job.id, {
    documentStatus: 'ready',
    chunksSaved: chunks.length,
  })

  return { documentStatus: 'ready', chunksSaved: chunks.length }
}

async function failJob(
  job: Job,
  payload: IngestDocumentJobPayload,
  deps: ProcessJobDependencies,
  reason: string
): Promise<ProcessJobResult> {
  const sessionId = SessionId.create(payload.sessionId)
  const documentId = DocumentId.create(payload.documentId)

  await deps.documentRepository.updateStatus(
    sessionId,
    documentId,
    'failed',
    new Date()
  )
  await deps.pdfFileStore.remove(payload.storagePath)
  await deps.jobQueue.markFailed(job.id, reason)

  return { documentStatus: 'failed', chunksSaved: 0 }
}

export async function processNextJob(
  deps: ProcessJobDependencies
): Promise<ProcessJobResult | null> {
  const job = await deps.jobQueue.claimNextJob()

  if (!job) {
    return null
  }

  try {
    return await processJob(job, deps)
  } catch (error) {
    await recoverUnexpectedFailure(job, deps)
    throw error
  }
}

async function recoverUnexpectedFailure(
  job: Job,
  deps: ProcessJobDependencies
): Promise<void> {
  await deps.jobQueue.markFailed(job.id, 'error_interno')

  let payload: IngestDocumentJobPayload

  try {
    payload = readJobPayload(job)
  } catch {
    return
  }

  const sessionId = SessionId.create(payload.sessionId)
  const documentId = DocumentId.create(payload.documentId)
  const document = await deps.documentRepository.findById(sessionId, documentId)

  if (document && !DocumentState.from(document.status).isTerminal()) {
    await deps.documentRepository.updateStatus(
      sessionId,
      documentId,
      'failed',
      new Date()
    )
  }

  await deps.pdfFileStore.remove(payload.storagePath)
}
