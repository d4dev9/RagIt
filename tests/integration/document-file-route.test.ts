import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GET } from '../../src/app/api/documents/[id]/file/route'
import { DocumentId } from '../../src/domain/documents/document-id'
import { PostgresDocumentRepository } from '../../src/infrastructure/database/postgres-document-repository'
import { PostgresSessionRepository } from '../../src/infrastructure/database/postgres-session-repository'
import { getPostgresPool } from '../../src/infrastructure/database/postgres-pool'
import { LocalPdfFileStore } from '../../src/infrastructure/storage/pdf-file-store'
import type { SessionId } from '../../src/domain/sessions/session-id'
import {
  createAppPool,
  createDocumentRecord,
  createSession,
  integrationEnabled,
  migrateDatabase,
} from './test-database'

const cookieState = vi.hoisted(() => {
  let value: string | undefined

  return {
    get(name: string): { readonly value: string } | undefined {
      return name === 'ragit_session' && value ? { value } : undefined
    },
    set(name: string, nextValue: string): void {
      if (name === 'ragit_session') {
        value = nextValue
      }
    },
    use(nextValue: string): void {
      value = nextValue
    },
  }
})

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: cookieState.get,
    set: cookieState.set,
  }),
}))

const originalDatabaseUrl = process.env.DATABASE_URL
const originalStorageDirectory = process.env.PDF_STORAGE_DIR

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>
}

function request(documentId: DocumentId): [Request, RouteContext] {
  return [
    new Request('https://localhost'),
    { params: Promise.resolve({ id: documentId.toString() }) },
  ]
}

describe.skipIf(!integrationEnabled)('GET /api/documents/:id/file', () => {
  let pool: ReturnType<typeof createAppPool>
  let storageDirectory: string
  let files: LocalPdfFileStore
  let documents: PostgresDocumentRepository
  let sessions: PostgresSessionRepository
  let sessionA: SessionId | undefined
  let sessionB: SessionId | undefined
  let ownDocumentId: DocumentId | undefined
  let foreignDocumentId: DocumentId | undefined
  let legacyDocumentId: DocumentId | undefined
  let missingFileDocumentId: DocumentId | undefined

  beforeAll(async () => {
    await migrateDatabase()
    storageDirectory = await mkdtemp(join(tmpdir(), 'ragit-document-file-'))
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.PDF_STORAGE_DIR = storageDirectory
    pool = createAppPool()
    files = new LocalPdfFileStore(storageDirectory)
    documents = new PostgresDocumentRepository(pool)
    sessions = new PostgresSessionRepository(pool)

    const ownSession = createSession()
    const foreignSession = createSession()
    sessionA = ownSession.id
    sessionB = foreignSession.id
    await sessions.save(ownSession)
    await sessions.save(foreignSession)

    const ownStoragePath = await files.save(Buffer.from('%PDF-1.4 own'))
    const foreignStoragePath = await files.save(Buffer.from('%PDF-1.4 foreign'))
    const ownDocument = createDocumentRecord({
      storagePath: ownStoragePath,
      displayName: 'propio.pdf',
      status: 'ready',
    })
    const foreignDocument = createDocumentRecord({
      storagePath: foreignStoragePath,
      displayName: 'ajeno.pdf',
      status: 'ready',
    })
    const legacyDocument = createDocumentRecord({
      storagePath: null,
      displayName: 'Documento no disponible',
      status: 'ready',
    })
    const missingFileDocument = createDocumentRecord({
      displayName: 'archivo-ausente.pdf',
      status: 'ready',
    })
    ownDocumentId = ownDocument.id
    foreignDocumentId = foreignDocument.id
    legacyDocumentId = legacyDocument.id
    missingFileDocumentId = missingFileDocument.id

    await documents.save(ownSession.id, ownDocument)
    await documents.save(foreignSession.id, foreignDocument)
    await documents.save(ownSession.id, legacyDocument)
    await documents.save(ownSession.id, missingFileDocument)
  })

  afterAll(async () => {
    if (sessionA && sessionB) {
      await sessions.delete(sessionA)
      await sessions.delete(sessionB)
    }

    await getPostgresPool().end()
    await pool.end()
    await rm(storageDirectory, { recursive: true, force: true })

    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl
    }

    if (originalStorageDirectory === undefined) {
      delete process.env.PDF_STORAGE_DIR
    } else {
      process.env.PDF_STORAGE_DIR = originalStorageDirectory
    }
  })

  it('devuelve el PDF propio con el tipo de contenido y cabeceras requeridas', async () => {
    if (!sessionA || !ownDocumentId) {
      throw new Error('El documento de prueba no fue inicializado')
    }

    cookieState.use(sessionA.toString())
    const [requestValue, context] = request(ownDocumentId)
    const response = await GET(requestValue, context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe('inline')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.text()).toBe('%PDF-1.4 own')
  })

  it('no revela un documento que pertenece a otra sesión', async () => {
    if (!sessionA || !foreignDocumentId) {
      throw new Error('El documento de otra sesión no fue inicializado')
    }

    cookieState.use(sessionA.toString())
    const [requestValue, context] = request(foreignDocumentId)
    const response = await GET(requestValue, context)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: 'Documento no encontrado',
      code: 'DOCUMENT_NOT_FOUND',
    })
  })

  it('responde no disponible para documentos sin storagePath', async () => {
    if (!sessionA || !legacyDocumentId) {
      throw new Error('El documento antiguo no fue inicializado')
    }

    cookieState.use(sessionA.toString())
    const [requestValue, context] = request(legacyDocumentId)
    const response = await GET(requestValue, context)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: 'Documento no disponible',
      code: 'DOCUMENT_UNAVAILABLE',
    })
  })

  it('registra el error y responde 404 cuando el archivo falta en disco', async () => {
    if (!sessionA || !missingFileDocumentId) {
      throw new Error('El documento sin archivo no fue inicializado')
    }

    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    cookieState.use(sessionA.toString())
    const [requestValue, context] = request(missingFileDocumentId)
    const response = await GET(requestValue, context)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: 'Documento no encontrado',
      code: 'DOCUMENT_NOT_FOUND',
    })
    expect(logError).toHaveBeenCalledOnce()
    logError.mockRestore()
  })
})
