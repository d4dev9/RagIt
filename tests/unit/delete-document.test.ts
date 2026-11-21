import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deleteDocument } from '../../src/application/delete-document'
import { SessionId } from '../../src/domain/sessions/session-id'
import {
  MemoryChunkRepository,
  MemoryDocumentRepository,
  MemoryJobQueue,
  MemoryPdfFileStore,
  newChunkId,
  newDocumentRecord,
} from './support/fakes'

describe('deleteDocument (F-08)', () => {
  it('keeps the document retryable when file deletion fails', async () => {
    const sessionId = SessionId.create(randomUUID())
    const documents = new MemoryDocumentRepository()
    const chunks = new MemoryChunkRepository()
    const jobs = new MemoryJobQueue()
    const files = new MemoryPdfFileStore()
    const baseRecord = newDocumentRecord('ready')
    const storagePath = await files.save(Buffer.from('%PDF-1.4'))
    const record = { ...baseRecord, storagePath }
    await documents.save(sessionId, record)
    await chunks.saveMany(sessionId, record.id, [
      {
        id: newChunkId(),
        page: 1,
        index: 0,
        content: 'contenido',
        embedding: Array.from({ length: 768 }, () => 0.1),
      },
    ])
    const job = await jobs.submitIngestJob({
      documentId: record.id.toString(),
      sessionId: sessionId.toString(),
      storagePath,
      pdfByteLength: 8,
    })
    const removeFile = files.remove.bind(files)
    files.remove = async () => {
      throw new Error('disco no disponible')
    }

    await expect(
      deleteDocument(sessionId, record.id.toString(), {
        documentRepository: documents,
        chunkRepository: chunks,
        jobQueue: jobs,
        pdfFileStore: files,
      })
    ).rejects.toThrow('disco no disponible')

    expect(await documents.findById(sessionId, record.id)).not.toBeNull()
    expect(await chunks.listByDocument(sessionId, record.id)).toEqual([])
    expect(await jobs.getJob(job.id)).toBeNull()
    expect(files.files.has(storagePath)).toBe(true)

    files.remove = removeFile

    await expect(
      deleteDocument(sessionId, record.id.toString(), {
        documentRepository: documents,
        chunkRepository: chunks,
        jobQueue: jobs,
        pdfFileStore: files,
      })
    ).resolves.toBe(true)
    expect(await documents.findById(sessionId, record.id)).toBeNull()
    expect(files.files.has(storagePath)).toBe(false)
  })
})
