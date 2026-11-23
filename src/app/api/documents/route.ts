import { Buffer } from 'node:buffer'
import {
  DocumentQuotaExceededError,
  InvalidPdfSignatureError,
  PdfTooLargeError,
} from '../../../domain/documents/document-errors'
import { MAX_PDF_SIZE_BYTES } from '../../../domain/documents/document-limits'
import { ingestionFailureMessage } from '../../../domain/documents/ingestion-failure'
import { uploadDocument } from '../../../application/upload-document'
import { getPostgresPool } from '../../../infrastructure/database/postgres-pool'
import { MissingDatabaseUrlError } from '../../../infrastructure/database/postgres-pool'
import { PostgresDocumentRepository } from '../../../infrastructure/database/postgres-document-repository'
import {
  InvalidJobQueueConfigError,
  PostgresJobQueue,
} from '../../../infrastructure/database/postgres-job-queue'
import { PostgresSessionRepository } from '../../../infrastructure/database/postgres-session-repository'
import { createPdfFileStoreFromEnv } from '../../../infrastructure/storage/pdf-file-store'
import { getOrCreateApiSession } from '../../../lib/api-session'
import {
  apiError,
  serviceUnavailableResponse,
} from '../../../lib/api-response'
import { createRequestId, logger } from '../../../lib/logger'

const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const requestId = createRequestId()

  try {
    const pool = getPostgresPool()
    const contentLength = Number(request.headers.get('content-length'))

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_PDF_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
    ) {
      return apiError(
        ingestionFailureMessage('TOO_LARGE'),
        'TOO_LARGE',
        requestId,
        413
      )
    }

    let formData: FormData

    try {
      formData = await request.formData()
    } catch {
      return Response.json(
        { error: 'La solicitud no es válida', code: 'INVALID_REQUEST', requestId },
        { status: 400 }
      )
    }

    const entries = Array.from(formData.keys())
    const file = formData.get('file')

    if (
      entries.length !== 1 ||
      entries[0] !== 'file' ||
      !(file instanceof File)
    ) {
      return apiError('La solicitud no es válida', 'INVALID_REQUEST', requestId, 400)
    }

    if (file.size > MAX_PDF_SIZE_BYTES) {
      return apiError(
        ingestionFailureMessage('TOO_LARGE'),
        'TOO_LARGE',
        requestId,
        413
      )
    }

    if (file.type !== 'application/pdf') {
      return apiError(
        ingestionFailureMessage('NOT_PDF'),
        'NOT_PDF',
        requestId,
        400
      )
    }

    const sessionRepository = new PostgresSessionRepository(pool)
    const sessionId = await getOrCreateApiSession(sessionRepository)
    const result = await uploadDocument(
      sessionId,
      Buffer.from(await file.arrayBuffer()),
      {
        documentRepository: new PostgresDocumentRepository(pool),
        jobQueue: new PostgresJobQueue(pool),
        pdfFileStore: createPdfFileStoreFromEnv(),
        displayName: file.name,
      }
    )

    return Response.json(
      {
        documentId: result.documentId,
        displayName: result.displayName,
        status: result.documentStatus,
        requestId,
      },
      { status: 202 }
    )
  } catch (error) {
    if (error instanceof MissingDatabaseUrlError) {
      logger.error({ event: 'database_configuration_missing', requestId, error })

      return serviceUnavailableResponse(requestId)
    }

    if (error instanceof InvalidJobQueueConfigError) {
      logger.error({ event: 'job_queue_configuration_invalid', requestId, error })

      return serviceUnavailableResponse(requestId)
    }

    if (
      error instanceof InvalidPdfSignatureError ||
      error instanceof PdfTooLargeError
    ) {
      return apiError(
        ingestionFailureMessage(
          error instanceof PdfTooLargeError ? 'TOO_LARGE' : 'NOT_PDF'
        ),
        error instanceof PdfTooLargeError ? 'TOO_LARGE' : 'NOT_PDF',
        requestId,
        error instanceof PdfTooLargeError ? 413 : 400
      )
    }

    if (error instanceof DocumentQuotaExceededError) {
      return apiError('Se alcanzó el límite de documentos', 'DOCUMENT_QUOTA', requestId, 409)
    }

    logger.error({ event: 'document_upload_failed', requestId, error })

    return apiError('No se pudo procesar el documento', 'INTERNAL_ERROR', requestId, 500)
  }
}

export async function GET(): Promise<Response> {
  const requestId = createRequestId()

  try {
    const pool = getPostgresPool()
    const sessionRepository = new PostgresSessionRepository(pool)
    const sessionId = await getOrCreateApiSession(sessionRepository)
    const documents = await new PostgresDocumentRepository(pool).listBySession(
      sessionId
    )

    return Response.json({
      documents: documents.map((document) => ({
        documentId: document.id.toString(),
        displayName: document.displayName,
        available: document.storagePath !== null,
        status: document.status,
        sizeBytes: document.sizeBytes,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
        ...(document.status === 'failed'
          ? {
              errorMessage: ingestionFailureMessage(
                document.failureCode ?? 'UNKNOWN'
              ),
            }
          : {}),
      })),
      requestId,
    })
  } catch (error) {
    logger.error({ event: 'document_list_failed', requestId, error })

    return apiError(
      'No se pudieron consultar los documentos',
      'INTERNAL_ERROR',
      requestId,
      500
    )
  }
}
