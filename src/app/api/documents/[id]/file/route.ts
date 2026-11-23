import { InvalidDocumentIdError } from '../../../../../domain/documents/document-errors'
import { DocumentId } from '../../../../../domain/documents/document-id'
import { getPostgresPool } from '../../../../../infrastructure/database/postgres-pool'
import { PostgresDocumentRepository } from '../../../../../infrastructure/database/postgres-document-repository'
import { PostgresSessionRepository } from '../../../../../infrastructure/database/postgres-session-repository'
import {
  createPdfFileStoreFromEnv,
  PdfNotFoundError,
} from '../../../../../infrastructure/storage/pdf-file-store'
import { getOrCreateApiSession } from '../../../../../lib/api-session'
import { apiError } from '../../../../../lib/api-response'
import { createRequestId, logger } from '../../../../../lib/logger'

interface DocumentFileRouteContext {
  readonly params: Promise<{ readonly id: string }>
}

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  context: DocumentFileRouteContext
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
      logger.error({
        event: 'document_pdf_missing',
        requestId,
        error,
      })

      return apiError('Documento no encontrado', 'DOCUMENT_NOT_FOUND', requestId, 404)
    }

    logger.error({ event: 'document_file_open_failed', requestId, error })

    return apiError('No se pudo abrir el documento', 'INTERNAL_ERROR', requestId, 500)
  }
}
