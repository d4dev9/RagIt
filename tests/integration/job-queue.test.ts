import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgresJobQueue } from '../../src/infrastructure/database/postgres-job-queue'
import {
  createAdminPool,
  createAppPool,
  integrationEnabled,
  migrateDatabase,
} from './test-database'

const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF')

describe.skipIf(!integrationEnabled)('PostgresJobQueue', () => {
  let appPool: Pool
  let adminPool: Pool
  let queue: PostgresJobQueue
  const created: string[] = []

  beforeAll(async () => {
    await migrateDatabase()
    appPool = createAppPool()
    adminPool = createAdminPool()
    queue = new PostgresJobQueue(appPool)
    await adminPool.query('DELETE FROM jobs')
  })

  beforeEach(async () => {
    await adminPool.query("DELETE FROM jobs WHERE status = 'pending'")
  })

  afterAll(async () => {
    if (created.length > 0) {
      await adminPool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [
        created,
      ])
    }

    await appPool.end()
    await adminPool.end()
  })

  async function submit(): Promise<string> {
    const job = await queue.submitIngestJob(
      randomUUID(),
      randomUUID(),
      PDF_BYTES,
      'documento.pdf'
    )

    created.push(job.id)

    return job.id
  }

  it('inserta trabajos pendientes con el PDF en base64', async () => {
    const jobId = await submit()
    const job = await queue.getJob(jobId)

    expect(job?.status).toBe('pending')
    expect(job?.attempts).toBe(0)
    expect(job?.payload.pdfBase64).toBe(PDF_BYTES.toString('base64'))
  })

  it('reclama un trabajo con FOR UPDATE SKIP LOCKED y suma un intento', async () => {
    const jobId = await submit()
    const claimed = await queue.claimNextJob()

    expect(claimed?.id).toBe(jobId)
    expect(claimed?.status).toBe('processing')
    expect(claimed?.attempts).toBe(1)
  })

  it('marca un trabajo reclamado como ready', async () => {
    const jobId = await submit()
    await queue.claimNextJob()
    await queue.markReady(jobId, { chunksSaved: 2 })
    const job = await queue.getJob(jobId)

    expect(job?.status).toBe('ready')
    expect(job?.result?.chunksSaved).toBe(2)
  })

  it('marca un trabajo reclamado como failed', async () => {
    const jobId = await submit()
    await queue.claimNextJob()
    await queue.markFailed(jobId, 'fallo controlado')
    const job = await queue.getJob(jobId)

    expect(job?.status).toBe('failed')
    expect(job?.error).toBe('fallo controlado')
  })

  it('reparte trabajos concurrentes sin reclamar el mismo dos veces', async () => {
    const first = await submit()
    const second = await submit()
    const [claimedFirst, claimedSecond] = await Promise.all([
      queue.claimNextJob(),
      queue.claimNextJob(),
    ])
    const ids = [claimedFirst?.id, claimedSecond?.id]

    expect(ids).toContain(first)
    expect(ids).toContain(second)
    expect(new Set(ids).size).toBe(2)
  })
})
