import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { uploadDocument } from '../../src/application/upload-document'
import {
  DocumentQuotaExceededError,
  InvalidPdfSignatureError,
  PdfTooLargeError,
} from '../../src/domain/documents/document-errors'
import { MAX_DOCUMENTS_PER_SESSION, MAX_PDF_SIZE_BYTES } from '../../src/domain/documents/document-limits'
import { SessionId } from '../../src/domain/sessions/session-id'
import {
  fixture,
  MemoryDocumentRepository,
  MemoryJobQueue,
  MemoryPdfFileStore,
  newDocumentRecord,
} from './support/fakes'

function deps(overrides: Partial<{ jobQueue: MemoryJobQueue; files: MemoryPdfFileStore }> = {}) {
  const documents = new MemoryDocumentRepository()
  const jobQueue = overrides.jobQueue ?? new MemoryJobQueue()
  const files = overrides.files ?? new MemoryPdfFileStore()

  return { documents, jobQueue, files, deps: { documentRepository: documents, jobQueue, pdfFileStore: files } }
}

describe('uploadDocument (F-02, F-08)', () => {
  it('rechaza bytes que no tienen firma PDF y no guarda nada', async () => {
    const { documents, files, deps: d } = deps()
    const sessionId = SessionId.create(randomUUID())

    await expect(
      uploadDocument(sessionId, Buffer.from('<html>no</html>'), d)
    ).rejects.toBeInstanceOf(InvalidPdfSignatureError)

    expect(files.files.size).toBe(0)
    expect(await documents.countBySession(sessionId)).toBe(0)
  })

  it('rechaza un PDF mayor de 5 MB', async () => {
    const { deps: d } = deps()
    const oversized = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(MAX_PDF_SIZE_BYTES),
    ])

    await expect(
      uploadDocument(SessionId.create(randomUUID()), oversized, d)
    ).rejects.toBeInstanceOf(PdfTooLargeError)
  })

  it('rechaza la subida número seis de una sesión', async () => {
    const { documents, deps: d } = deps()
    const sessionId = SessionId.create(randomUUID())

    for (let i = 0; i < MAX_DOCUMENTS_PER_SESSION; i += 1) {
      await documents.save(sessionId, newDocumentRecord())
    }

    await expect(
      uploadDocument(sessionId, fixture('01_texto_factura.pdf'), d)
    ).rejects.toBeInstanceOf(DocumentQuotaExceededError)
  })

  it('guarda el PDF y encola un trabajo que apunta al archivo guardado', async () => {
    const { documents, files, jobQueue, deps: d } = deps()
    const sessionId = SessionId.create(randomUUID())
    const pdf = fixture('01_texto_factura.pdf')

    const output = await uploadDocument(sessionId, pdf, d)

    expect(output.documentStatus).toBe('pending')
    expect(documents.statusOf(output.documentId)).toBe('pending')
    expect(jobQueue.submitted).toHaveLength(1)

    const [payload] = jobQueue.submitted
    expect(payload?.documentId).toBe(output.documentId)
    expect(payload?.pdfByteLength).toBe(pdf.byteLength)
    expect(payload?.storagePath).toMatch(/^[0-9a-f-]{36}\.pdf$/)
    expect(files.files.has(payload?.storagePath ?? '')).toBe(true)
    expect(JSON.stringify(payload)).not.toContain('pdfBase64')
  })

  it('si el encolado falla, borra el archivo y marca el documento como failed', async () => {
    const jobQueue = new MemoryJobQueue()
    jobQueue.submitIngestJob = async () => {
      throw new Error('cola caída')
    }
    const { documents, files, deps: d } = deps({ jobQueue })
    const sessionId = SessionId.create(randomUUID())

    await expect(
      uploadDocument(sessionId, fixture('01_texto_factura.pdf'), d)
    ).rejects.toThrow('cola caída')

    expect(files.files.size).toBe(0)
    const [only] = await documents.listBySession(sessionId)
    expect(only?.status).toBe('failed')
  })

  it('si el almacenamiento falla, no encola nada y marca el documento como failed', async () => {
    const { documents, jobQueue, deps: d } = deps()
    d.pdfFileStore.save = async () => {
      throw new Error('disco lleno')
    }
    const sessionId = SessionId.create(randomUUID())

    await expect(
      uploadDocument(sessionId, fixture('01_texto_factura.pdf'), d)
    ).rejects.toThrow('disco lleno')

    expect(jobQueue.submitted).toHaveLength(0)
    const [only] = await documents.listBySession(sessionId)
    expect(only?.status).toBe('failed')
  })
})
