import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgresJobQueue } from '../../src/infrastructure/database/postgres-job-queue'
import { createAppPool, integrationEnabled, migrateDatabase } from './test-database'

describe.skipIf(!integrationEnabled)('PostgresJobQueue', () => {
  let pool: Pool
  let queue: PostgresJobQueue
  const sessionId = randomUUID()
  const jobIds: string[] = []

  beforeAll(async () => {
    await migrateDatabase()
    pool = createAppPool()
    queue = new PostgresJobQueue(pool)
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM jobs WHERE payload->>'sessionId' = $1`, [sessionId])
    await pool.end()
  })

  async function claimUntil(id: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const claimed = await queue.claimNextJob()
      if (!claimed) return null
      if (claimed.id === id) return claimed
    }
    return null
  }

  function payload(storagePath = `${randomUUID()}.pdf`) {
    return {
      documentId: randomUUID(),
      sessionId,
      storagePath,
      pdfByteLength: 2244,
    }
  }

  it('guarda solo referencias y metadatos, sin contenido del PDF', async () => {
    const job = await queue.submitIngestJob(payload())
    jobIds.push(job.id)

    expect(job.status).toBe('pending')
    expect(job.payload).not.toHaveProperty('pdfBase64')
    expect(job.payload).toHaveProperty('storagePath')
    expect(job.payload).toHaveProperty('pdfByteLength', 2244)
  })

  it('reclama un trabajo una sola vez y lo cierra como ready', async () => {
    const submitted = await queue.submitIngestJob(payload())
    jobIds.push(submitted.id)

    const claimed = await claimUntil(submitted.id)
    const again = await queue.getJob(submitted.id)

    expect(claimed?.id).toBe(submitted.id)
    expect(again?.status).toBe('processing')
    expect(again?.attempts).toBe(1)

    await queue.markReady(submitted.id, { chunksSaved: 3 })
    const done = await queue.getJob(submitted.id)

    expect(done?.status).toBe('ready')
    expect(done?.result).toEqual({ chunksSaved: 3 })
  })

  it('cierra un trabajo como failed con su motivo', async () => {
    const submitted = await queue.submitIngestJob(payload())
    jobIds.push(submitted.id)

    await claimUntil(submitted.id)
    await queue.markFailed(submitted.id, 'sin_texto_extraible')
    const failed = await queue.getJob(submitted.id)

    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('sin_texto_extraible')
  })
})
