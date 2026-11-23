import { InvalidDocumentIdError } from '../../../../domain/documents/document-errors'
import { DocumentId } from '../../../../domain/documents/document-id'
import { deleteDocument } from '../../../../application/delete-document'
import { getPostgresPool } from '../../../../infrastructure/database/postgres-pool'
import { PostgresChunkRepository } from '../../../../infrastructure/database/postgres-chunk-repository'
import { PostgresDocumentRepository } from '../../../../infrastructure/database/postgres-document-repository'
import { PostgresJobQueue } from '../../../../infrastructure/database/postgres-job-queue'
import { PostgresSessionRepository } from '../../../../infrastructure/database/postgres-session-repository'
import {
  createPdfFileStoreFromEnv,
  PdfNotFoundError,
} from '../../../../infrastructure/storage/pdf-file-store'
import { getOrCreateApiSession } from '../../../../lib/api-session'
import { apiError } from '../../../../lib/api-response'
import { createRequestId, logger } from '../../../../lib/logger'

interface DocumentRouteContext {
  readonly params: Promise<{ readonly id: string }>
}

export async function GET(
  _request: Request,
  context: DocumentRouteContext
): Promise<Response> {
  const requestId = createRequestId()

  try {
    const { id } = await context.params
    const documentId = DocumentId.create(id)
    const pool = getPostgresPool()
    const sessionId = await getOrCreateApiSession(
      new PostgresSessionRepository(pool)
    )
    const document = await new PostgresDocumentRepository(pool).findById(
      sessionId,
      documentId
    )

    if (!document) {
      return apiError('Documento no encontrado', 'DOCUMENT_NOT_FOUND', requestId, 404)
    }

    if (!document.storagePath) {
      return apiError('Documento no disponible', 'DOCUMENT_UNAVAILABLE', requestId, 404)
    }

    const pdf = await createPdfFileStoreFromEnv().read(document.storagePath)

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof InvalidDocumentIdError) {
      return apiError('Documento no encontrado', 'DOCUMENT_NOT_FOUND', requestId, 404)
    }

    if (error instanceof PdfNotFoundError) {
      return apiError('Documento no encontrado', 'DOCUMENT_NOT_FOUND', requestId, 404)
    }

    logger.error({ event: 'document_file_open_failed', requestId, error })

    return apiError('No se pudo abrir el documento', 'INTERNAL_ERROR', requestId, 500)
  }
}

export async function DELETE(
  _request: Request,
  context: DocumentRouteContext
): Promise<Response> {
  const requestId = createRequestId()

  try {
    const { id } = await context.params
    const pool = getPostgresPool()
    const sessionId = await getOrCreateApiSession(
      new PostgresSessionRepository(pool)
    )
    const removed = await deleteDocument(sessionId, id, {
      documentRepository: new PostgresDocumentRepository(pool),
      chunkRepository: new PostgresChunkRepository(pool),
      jobQueue: new PostgresJobQueue(pool),
      pdfFileStore: createPdfFileStoreFromEnv(),
    })

    if (!removed) {
      return apiError('Documento no encontrado', 'DOCUMENT_NOT_FOUND', requestId, 404)
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof InvalidDocumentIdError) {
      return apiError('Documento no encontrado', 'DOCUMENT_NOT_FOUND', requestId, 404)
    }

    logger.error({ event: 'document_delete_failed', requestId, error })

    return apiError('No se pudo eliminar el documento', 'INTERNAL_ERROR', requestId, 500)
  }
}
