import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SessionId } from '../../src/domain/sessions/session-id'
import { DocumentId } from '../../src/domain/documents/document-id'
import {
  processJob,
  processNextJob,
  type ProcessJobDependencies,
} from '../../src/application/process-job'
import {
  fixture,
  FakeEmbeddingProvider,
  MemoryChunkRepository,
  MemoryDocumentRepository,
  MemoryJobQueue,
  MemoryPdfFileStore,
  newDocumentRecord,
} from './support/fakes'
import type { Job } from '../../src/ports/job-queue'

interface Scenario {
  readonly deps: ProcessJobDependencies
  readonly documents: MemoryDocumentRepository
  readonly chunks: MemoryChunkRepository
  readonly files: MemoryPdfFileStore
  readonly queue: MemoryJobQueue
  readonly sessionId: SessionId
  readonly documentId: DocumentId
  readonly job: Job
}

async function scenario(
  pdf: Buffer,
  options: {
    embeddings?: FakeEmbeddingProvider
    documentStatus?: 'pending' | 'processing' | 'ready' | 'failed'
    byteLengthOverride?: number
  } = {}
): Promise<Scenario> {
  const documents = new MemoryDocumentRepository()
  const chunks = new MemoryChunkRepository()
  const files = new MemoryPdfFileStore()
  const queue = new MemoryJobQueue()
  const sessionId = SessionId.create(randomUUID())
  const record = newDocumentRecord(options.documentStatus ?? 'pending')

  await documents.save(sessionId, record)

  const storagePath = await files.save(pdf)
  await queue.submitIngestJob({
    documentId: record.id.toString(),
    sessionId: sessionId.toString(),
    storagePath,
    pdfByteLength: options.byteLengthOverride ?? pdf.byteLength,
  })

  const job = await queue.claimNextJob()

  if (!job) {
    throw new Error('el trabajo de prueba no se encoló')
  }

  return {
    deps: {
      documentRepository: documents,
      chunkRepository: chunks,
      embeddingProvider: options.embeddings ?? new FakeEmbeddingProvider(),
      pdfFileStore: files,
      jobQueue: queue,
    },
    documents,
    chunks,
    files,
    queue,
    sessionId,
    documentId: record.id,
    job,
  }
}

describe('processJob (F-03, F-04, F-08)', () => {
  it('deja el documento ready con fragmentos por página y conserva el PDF', async () => {
    const s = await scenario(fixture('12_estado_cuenta_largo.pdf'))

    const result = await processJob(s.job, s.deps)

    expect(result.documentStatus).toBe('ready')
    expect(result.chunksSaved).toBeGreaterThan(0)
    expect(s.documents.statusOf(s.documentId.toString())).toBe('ready')
    expect(new Set(s.chunks.rows.map((row) => row.page))).toEqual(new Set([1, 2, 3]))
    expect(s.files.files.size).toBe(1)
    expect(s.queue.statusOf(s.job.id)).toBe('ready')
  })

  it('marca como failed un PDF sin capa de texto y conserva el archivo', async () => {
    const s = await scenario(fixture('07_escaneada_limpia.pdf'))

    const result = await processJob(s.job, s.deps)

    expect(result.documentStatus).toBe('failed')
    expect(result.chunksSaved).toBe(0)
    expect(s.documents.statusOf(s.documentId.toString())).toBe('failed')
    expect(s.chunks.rows).toHaveLength(0)
    expect(s.files.files.size).toBe(1)
    expect(s.queue.jobs.get(s.job.id)?.error).toBe('NO_EXTRACTABLE_TEXT')
  })

  it('marca como failed si el proveedor de embeddings falla', async () => {
    const s = await scenario(fixture('01_texto_factura.pdf'), {
      embeddings: new FakeEmbeddingProvider('fail'),
    })

    const result = await processJob(s.job, s.deps)

    expect(result.documentStatus).toBe('failed')
    expect(s.documents.statusOf(s.documentId.toString())).toBe('failed')
    expect(s.files.files.size).toBe(1)
    expect(s.queue.jobs.get(s.job.id)?.error).toBe('EMBEDDING_PROVIDER_FAILED')
  })

  it('rechaza embeddings incompletos sin guardar fragmentos', async () => {
    const s = await scenario(fixture('12_estado_cuenta_largo.pdf'), {
      embeddings: new FakeEmbeddingProvider('short'),
    })

    const result = await processJob(s.job, s.deps)

    expect(result.documentStatus).toBe('failed')
    expect(s.chunks.rows).toHaveLength(0)
    expect(s.queue.jobs.get(s.job.id)?.error).toBe('EMBEDDING_PROVIDER_FAILED')
  })

  it('falla si el tamaño leído no coincide con el registrado', async () => {
    const s = await scenario(fixture('01_texto_factura.pdf'), {
      byteLengthOverride: 17,
    })

    const result = await processJob(s.job, s.deps)

    expect(result.documentStatus).toBe('failed')
    expect(s.queue.jobs.get(s.job.id)?.error).toBe('STORAGE_FAILED')
  })

  it('marca como ilegible un PDF con firma pero sin estructura reconocible', async () => {
    const pdf = Buffer.from('%PDF-1.4\ncontenido truncado')
    const s = await scenario(pdf)

    const result = await processJob(s.job, s.deps)

    expect(result.documentStatus).toBe('failed')
    expect(s.queue.jobs.get(s.job.id)?.error).toBe('UNREADABLE_PDF')
  })

  it('no reprocesa un documento que ya está en estado terminal', async () => {
    const embeddings = new FakeEmbeddingProvider()
    const s = await scenario(fixture('01_texto_factura.pdf'), {
      documentStatus: 'ready',
      embeddings,
    })

    const result = await processJob(s.job, s.deps)

    expect(result).toEqual({ documentStatus: 'ready', chunksSaved: 0 })
    expect(embeddings.calls).toBe(0)
    expect(s.queue.statusOf(s.job.id)).toBe('ready')
  })

  it('lanza error si el documento del trabajo no existe', async () => {
    const s = await scenario(fixture('01_texto_factura.pdf'))
    const orphan: Job = {
      ...s.job,
      payload: { ...s.job.payload, documentId: randomUUID() },
    }

    const result = await processJob(orphan, s.deps)

    expect(result.documentStatus).toBe('failed')
    expect(s.queue.jobs.get(orphan.id)?.error).toBe('UNKNOWN')
  })
})

describe('processNextJob', () => {
  it('devuelve null cuando no hay trabajos pendientes', async () => {
    const s = await scenario(fixture('01_texto_factura.pdf'))

    expect(await processNextJob(s.deps)).toBeNull()
  })

  it('marca como failed un trabajo con payload inválido', async () => {
    const s = await scenario(fixture('01_texto_factura.pdf'))
    const orphan: Job = {
      ...s.job,
      payload: { ...s.job.payload, documentId: randomUUID() },
    }
    const queue = new MemoryJobQueue()

    await queue.submitIngestJob({
      documentId: orphan.payload.documentId as string,
      sessionId: s.sessionId.toString(),
      storagePath: 'no-existe.pdf',
      pdfByteLength: 1,
    })

    const result = await processNextJob({ ...s.deps, jobQueue: queue })

    const [claimed] = [...queue.jobs.values()]

    expect(result?.documentStatus).toBe('failed')
    expect(claimed?.status).toBe('failed')
    expect(claimed?.error).toBe('UNKNOWN')
  })
})
