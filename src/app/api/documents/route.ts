import { Buffer } from 'node:buffer'
import {
  DocumentQuotaExceededError,
  InvalidPdfSignatureError,
  PdfTooLargeError,
} from '../../../domain/documents/document-errors'
import { MAX_PDF_SIZE_BYTES } from '../../../domain/documents/document-limits'
import { uploadDocument } from '../../../application/upload-document'
import { getPostgresPool } from '../../../infrastructure/database/postgres-pool'
import { PostgresDocumentRepository } from '../../../infrastructure/database/postgres-document-repository'
import { PostgresJobQueue } from '../../../infrastructure/database/postgres-job-queue'
import { PostgresSessionRepository } from '../../../infrastructure/database/postgres-session-repository'
import { createPdfFileStoreFromEnv } from '../../../infrastructure/storage/pdf-file-store'
import { getOrCreateApiSession } from '../../../lib/api-session'

const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getPostgresPool()
    const sessionRepository = new PostgresSessionRepository(pool)
    const sessionId = await getOrCreateApiSession(sessionRepository)
    const contentLength = Number(request.headers.get('content-length'))

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_PDF_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
    ) {
      return Response.json(
        { error: 'El archivo no es válido' },
        { status: 413 }
      )
    }

    let formData: FormData

    try {
      formData = await request.formData()
    } catch {
      return Response.json(
        { error: 'La solicitud no es válida' },
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
      return Response.json(
        { error: 'La solicitud no es válida' },
        { status: 400 }
      )
    }

    if (file.size > MAX_PDF_SIZE_BYTES) {
      return Response.json(
        { error: 'El archivo no es válido' },
        { status: 413 }
      )
    }

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
      },
      { status: 202 }
    )
  } catch (error) {
    if (
      error instanceof InvalidPdfSignatureError ||
      error instanceof PdfTooLargeError
    ) {
      return Response.json(
        { error: 'El archivo no es válido' },
        { status: error instanceof PdfTooLargeError ? 413 : 400 }
      )
    }

    if (error instanceof DocumentQuotaExceededError) {
      return Response.json(
        { error: 'Se alcanzó el límite de documentos' },
        { status: 409 }
      )
    }

    console.error('Error interno al subir un documento')

    return Response.json(
      { error: 'No se pudo procesar el documento' },
      { status: 500 }
    )
  }
}

export async function GET(): Promise<Response> {
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
      })),
    })
  } catch {
    console.error('Error interno al listar documentos')

    return Response.json(
      { error: 'No se pudieron consultar los documentos' },
      { status: 500 }
    )
  }
}
