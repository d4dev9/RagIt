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

  async function claimUntil(id: string, targetQueue = queue) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const claimed = await targetQueue.claimNextJob()
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
    await queue.markFailed(submitted.id, 'NO_EXTRACTABLE_TEXT')
    const failed = await queue.getJob(submitted.id)

    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('NO_EXTRACTABLE_TEXT')
  })

  it('recupera un trabajo atascado y lo vuelve a reclamar', async () => {
    const recoveringQueue = new PostgresJobQueue(pool, {
      staleAfterMs: 1,
      maxAttempts: 3,
    })
    const submitted = await recoveringQueue.submitIngestJob(payload())
    jobIds.push(submitted.id)

    await claimUntil(submitted.id)
    await pool.query(
      `UPDATE jobs SET started_at = now() - interval '1 minute' WHERE id = $1`,
      [submitted.id]
    )

    const reclaimed = await claimUntil(submitted.id, recoveringQueue)

    expect(reclaimed?.id).toBe(submitted.id)
    expect(reclaimed?.attempts).toBe(2)
    expect((await recoveringQueue.getJob(submitted.id))?.status).toBe(
      'processing'
    )
  })

  it('marca como failed un trabajo atascado que agotó sus intentos', async () => {
    const recoveringQueue = new PostgresJobQueue(pool, {
      staleAfterMs: 1,
      maxAttempts: 3,
    })
    const submitted = await recoveringQueue.submitIngestJob(payload())
    jobIds.push(submitted.id)

    await claimUntil(submitted.id)
    await pool.query(
      `
        UPDATE jobs
        SET attempts = 3, started_at = now() - interval '1 minute'
        WHERE id = $1
      `,
      [submitted.id]
    )

    const next = await recoveringQueue.claimNextJob()
    const failed = await recoveringQueue.getJob(submitted.id)

    expect(next?.id).not.toBe(submitted.id)
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('UNKNOWN')
  })
})
