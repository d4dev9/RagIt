import { randomUUID } from 'node:crypto'
import { ChunkId } from '../domain/documents/chunk-id'
import { DocumentId } from '../domain/documents/document-id'
import { DocumentState } from '../domain/documents/document-status'
import type { DocumentStatus } from '../domain/documents/document-status'
import {
  MAX_DOCUMENT_PAGES,
} from '../domain/documents/document-limits'
import {
  InvalidEmbeddingError,
  InvalidPdfSignatureError,
  PageLimitExceededError,
  PdfTooLargeError,
} from '../domain/documents/document-errors'
import { assertEmbedding } from '../domain/documents/embedding'
import {
  MIN_PRINTABLE_CHARACTER_RATIO,
  printableCharacterRatio,
} from '../domain/documents/text-readability'
import type { IngestionFailureCode } from '../domain/documents/ingestion-failure'
import { assertPdfSignature } from '../domain/documents/pdf-signature'
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
  IngestionFailureError,
  IngestDocumentNotFoundError,
  InvalidIngestJobPayloadError,
} from './ingest-errors'
import { logger } from '../lib/logger'

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
  try {
    return await processJobContents(job, deps)
  } catch (error) {
    const code = getFailureCode(error)
    const technicalError =
      error instanceof IngestionFailureError && error.originalError !== undefined
        ? error.originalError
        : error

    logger.error({
      event: 'ingest_job_failed',
      requestId: job.id,
      error: technicalError,
    })

    await markJobFailed(job, deps, code)

    return { documentStatus: 'failed', chunksSaved: 0 }
  }
}

async function processJobContents(
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
  } catch (error) {
    throw new IngestionFailureError('STORAGE_FAILED', error)
  }

  if (pdfBytes.byteLength !== payload.pdfByteLength) {
    throw new IngestionFailureError('STORAGE_FAILED')
  }

  try {
    assertPdfSignature(pdfBytes)
  } catch (error) {
    if (error instanceof InvalidPdfSignatureError) {
      throw new IngestionFailureError('NOT_PDF', error)
    }

    throw error
  }

  const extracted = extractText(pdfBytes)

  if (extracted.nulCharactersRemoved > 0) {
    logger.info({
      event: 'ingest_null_characters_removed',
      requestId: job.id,
      nulCharactersRemoved: extracted.nulCharactersRemoved,
    })
  }

  const { pages } = extracted

  if (pages.length > MAX_DOCUMENT_PAGES) {
    throw new IngestionFailureError('TOO_LARGE', new PageLimitExceededError())
  }

  if (pages.length === 0) {
    throw new IngestionFailureError('UNREADABLE_PDF')
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

  const extractedContent = pages
    .flatMap((page) => page.segments)
    .join('\n')

  if (
    textChunks.length === 0 ||
    printableCharacterRatio(extractedContent) <
      MIN_PRINTABLE_CHARACTER_RATIO
  ) {
    throw new IngestionFailureError('NO_EXTRACTABLE_TEXT')
  }

  let embeddings: number[][]

  try {
    embeddings = await deps.embeddingProvider.embed(
      textChunks.map((chunk) => chunk.content)
    )
  } catch (error) {
    throw new IngestionFailureError('EMBEDDING_PROVIDER_FAILED', error)
  }

  if (embeddings.length !== textChunks.length) {
    throw new IngestionFailureError(
      'EMBEDDING_PROVIDER_FAILED',
      new InvalidEmbeddingError()
    )
  }

  const chunks: ChunkInput[] = textChunks.map((chunk, position) => {
    const embedding = embeddings[position]

    if (!embedding) {
      throw new IngestionFailureError(
        'EMBEDDING_PROVIDER_FAILED',
        new InvalidEmbeddingError()
      )
    }

    try {
      assertEmbedding(embedding)
    } catch (error) {
      throw new IngestionFailureError('EMBEDDING_PROVIDER_FAILED', error)
    }

    return {
      id: ChunkId.create(randomUUID()),
      page: chunk.page,
      index: chunk.index,
      content: chunk.content,
      embedding,
    }
  })

  await deps.chunkRepository.saveMany(
    sessionId,
    documentId,
    chunks,
    deps.embeddingProvider.modelName
  )

  await deps.documentRepository.updateStatus(
    sessionId,
    documentId,
    DocumentState.from('processing').transitionTo('ready').status,
    new Date()
  )

  await deps.jobQueue.markReady(job.id, {
    documentStatus: 'ready',
    chunksSaved: chunks.length,
  })

  return { documentStatus: 'ready', chunksSaved: chunks.length }
}

function getFailureCode(error: unknown): IngestionFailureCode {
  if (error instanceof IngestionFailureError) {
    return error.code
  }

  if (error instanceof InvalidPdfSignatureError) {
    return 'NOT_PDF'
  }

  if (error instanceof PdfTooLargeError || error instanceof PageLimitExceededError) {
    return 'TOO_LARGE'
  }

  return 'UNKNOWN'
}

async function markJobFailed(
  job: Job,
  deps: ProcessJobDependencies,
  code: IngestionFailureCode = 'UNKNOWN'
): Promise<void> {
  await deps.jobQueue.markFailed(job.id, code)

  let payload: IngestDocumentJobPayload

  try {
    payload = readJobPayload(job)
  } catch {
    return
  }

  try {
    const sessionId = SessionId.create(payload.sessionId)
    const documentId = DocumentId.create(payload.documentId)

    await deps.documentRepository.updateStatus(
      sessionId,
      documentId,
      'failed',
      new Date()
    )
  } catch (error) {
    logger.error({
      event: 'ingest_document_failure_status_update_failed',
      requestId: job.id,
      error,
    })
  }
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
    logger.error({
      event: 'ingest_job_failure_recording_failed',
      requestId: job.id,
      error,
    })

    try {
      await markJobFailed(job, deps, 'UNKNOWN')
    } catch (markError) {
      logger.error({
        event: 'ingest_job_failure_recording_retry_failed',
        requestId: job.id,
        error: markError,
      })
    }

    return { documentStatus: 'failed', chunksSaved: 0 }
  }
}
