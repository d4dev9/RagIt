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

interface DocumentRouteContext {
  readonly params: Promise<{ readonly id: string }>
}

export async function GET(
  _request: Request,
  context: DocumentRouteContext
): Promise<Response> {
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
      return Response.json({ error: 'Documento no encontrado' }, { status: 404 })
    }

    if (!document.storagePath) {
      return Response.json({ error: 'Documento no disponible' }, { status: 404 })
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
      return Response.json({ error: 'Documento no encontrado' }, { status: 404 })
    }

    if (error instanceof PdfNotFoundError) {
      return Response.json({ error: 'Documento no encontrado' }, { status: 404 })
    }

    console.error('Error interno al abrir un documento')

    return Response.json(
      { error: 'No se pudo abrir el documento' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  context: DocumentRouteContext
): Promise<Response> {
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
      return Response.json({ error: 'Documento no encontrado' }, { status: 404 })
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof InvalidDocumentIdError) {
      return Response.json({ error: 'Documento no encontrado' }, { status: 404 })
    }

    console.error('Error interno al eliminar un documento')

    return Response.json(
      { error: 'No se pudo eliminar el documento' },
      { status: 500 }
    )
  }
}
