import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { POST as uploadRoute } from '../../src/app/api/documents/route'
import { GET, DELETE } from '../../src/app/api/documents/[id]/route'
import { MAX_PDF_SIZE_BYTES } from '../../src/domain/documents/document-limits'
import { DocumentId } from '../../src/domain/documents/document-id'
import { PostgresChunkRepository } from '../../src/infrastructure/database/postgres-chunk-repository'
import { PostgresDocumentRepository } from '../../src/infrastructure/database/postgres-document-repository'
import { PostgresJobQueue } from '../../src/infrastructure/database/postgres-job-queue'
import { PostgresSessionRepository } from '../../src/infrastructure/database/postgres-session-repository'
import { getPostgresPool } from '../../src/infrastructure/database/postgres-pool'
import { LocalPdfFileStore } from '../../src/infrastructure/storage/pdf-file-store'
import type { SessionId } from '../../src/domain/sessions/session-id'
import {
  createAppPool,
  createChunkInput,
  createDocumentRecord,
  createEmbedding,
  createSession,
  integrationEnabled,
  migrateDatabase,
  TEST_EMBEDDING_MODEL_NAME,
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

describe.skipIf(!integrationEnabled)('rutas de archivo de documentos', () => {
  let pool: ReturnType<typeof createAppPool>
  let storageDirectory: string
  let files: LocalPdfFileStore
  let documents: PostgresDocumentRepository
  let sessions: PostgresSessionRepository
  let chunks: PostgresChunkRepository
  let jobs: PostgresJobQueue
  let sessionA: SessionId | undefined
  let sessionB: SessionId | undefined
  let documentA: DocumentId | undefined
  let documentB: DocumentId | undefined
  let fileA: string | undefined
  let fileB: string | undefined
  let jobA: string | undefined
  let jobB: string | undefined

  beforeAll(async () => {
    await migrateDatabase()
    storageDirectory = await mkdtemp(join(tmpdir(), 'ragit-routes-'))
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.PDF_STORAGE_DIR = storageDirectory
    pool = createAppPool()
    files = new LocalPdfFileStore(storageDirectory)
    documents = new PostgresDocumentRepository(pool)
    sessions = new PostgresSessionRepository(pool)
    chunks = new PostgresChunkRepository(pool)
    jobs = new PostgresJobQueue(pool)

    const firstSession = createSession()
    const secondSession = createSession()
    sessionA = firstSession.id
    sessionB = secondSession.id
    await sessions.save(firstSession)
    await sessions.save(secondSession)
    const firstFile = await files.save(
      await readFile('tests/fixtures/ocr/01_texto_factura.pdf')
    )
    const secondFile = await files.save(
      await readFile('tests/fixtures/ocr/01_texto_factura.pdf')
    )
    fileA = firstFile
    fileB = secondFile

    const firstDocument = createDocumentRecord({
      storagePath: firstFile,
      displayName: 'privado-a.pdf',
      status: 'ready',
    })
    const secondDocument = createDocumentRecord({
      storagePath: secondFile,
      displayName: 'privado-b.pdf',
      status: 'ready',
    })
    documentA = firstDocument.id
    documentB = secondDocument.id
    await documents.save(firstSession.id, firstDocument)
    await documents.save(secondSession.id, secondDocument)
    await chunks.saveMany(firstSession.id, firstDocument.id, [
      createChunkInput(0, 'fragmento de A', createEmbedding(0.1)),
    ], TEST_EMBEDDING_MODEL_NAME)
    await chunks.saveMany(secondSession.id, secondDocument.id, [
      createChunkInput(0, 'fragmento de B', createEmbedding(0.1)),
    ], TEST_EMBEDDING_MODEL_NAME)
    jobA = (
      await jobs.submitIngestJob({
      documentId: firstDocument.id.toString(),
      sessionId: firstSession.id.toString(),
      storagePath: firstFile,
      pdfByteLength: 100,
      })
    ).id
    jobB = (
      await jobs.submitIngestJob({
      documentId: secondDocument.id.toString(),
      sessionId: secondSession.id.toString(),
      storagePath: secondFile,
      pdfByteLength: 100,
      })
    ).id
  })

  afterAll(async () => {
    if (sessionA && sessionB) {
      await jobs.deleteBySession(sessionA)
      await jobs.deleteBySession(sessionB)
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

  it('rechaza tipos de archivo distintos de PDF con 400 antes de crear sesión', async () => {
    const formData = new FormData()
    formData.set('file', new File(['contenido'], 'nota.txt', { type: 'text/plain' }))
    const response = await uploadRoute(
      new Request('https://localhost/api/documents', {
        method: 'POST',
        body: formData,
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'Solo se admiten archivos PDF.',
      code: 'NOT_PDF',
    })
  })

  it('rechaza archivos mayores de 5 MB con 413 antes de leer el archivo', async () => {
    const formData = new FormData()
    formData.set(
      'file',
      new File(
        [new Uint8Array(MAX_PDF_SIZE_BYTES + 1)],
        'grande.pdf',
        { type: 'application/pdf' }
      )
    )
    const response = await uploadRoute(
      new Request('https://localhost/api/documents', {
        method: 'POST',
        body: formData,
      })
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: 'El archivo supera el límite de 5 MB.',
      code: 'TOO_LARGE',
    })
  })

  it('aisla el visor por sesión y elimina en orden sin afectar otra sesión', async () => {
    if (
      !sessionA ||
      !sessionB ||
      !documentA ||
      !documentB ||
      !fileA ||
      !fileB ||
      !jobA ||
      !jobB
    ) {
      throw new Error('Las entidades de prueba no fueron inicializadas')
    }

    cookieState.use(sessionA.toString())

    const foreignPdf = await GET(new Request('https://localhost'), {
      params: Promise.resolve({ id: documentB.toString() }),
    })
    const ownPdf = await GET(new Request('https://localhost'), {
      params: Promise.resolve({ id: documentA.toString() }),
    })

    expect(foreignPdf.status).toBe(404)
    expect(ownPdf.status).toBe(200)
    expect(ownPdf.headers.get('Content-Type')).toBe('application/pdf')
    expect((await ownPdf.arrayBuffer()).byteLength).toBeGreaterThan(0)

    const deniedDelete = await DELETE(new Request('https://localhost'), {
      params: Promise.resolve({ id: documentB.toString() }),
    })

    expect(deniedDelete.status).toBe(404)
    expect((await files.read(fileB)).byteLength).toBeGreaterThan(0)

    await files.remove(fileA)
    const removed = await DELETE(new Request('https://localhost'), {
      params: Promise.resolve({ id: documentA.toString() }),
    })

    expect(removed.status).toBe(204)
    await expect(files.read(fileA)).rejects.toThrow()
    expect(await documents.findById(sessionA, documentA)).toBeNull()
    expect(await chunks.listByDocument(sessionA, documentA)).toEqual([])
    expect(await jobs.getJob(jobA)).toBeNull()
    expect(await jobs.getJob(jobB)).not.toBeNull()
    expect((await files.read(fileB)).byteLength).toBeGreaterThan(0)
    expect(await documents.findById(sessionB, documentB)).not.toBeNull()

    cookieState.use(sessionB.toString())
    const removedB = await DELETE(new Request('https://localhost'), {
      params: Promise.resolve({ id: documentB.toString() }),
    })

    expect(removedB.status).toBe(204)
  })
})
