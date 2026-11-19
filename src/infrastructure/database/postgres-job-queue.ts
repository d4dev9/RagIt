import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { Job, JobQueue, JobStatus } from '../../ports/job-queue'
import { INGEST_DOCUMENT_JOB_TYPE } from '../../ports/job-queue'

type JobRow = {
  id: string
  type: string
  payload: unknown
  status: string
  attempts: number
  created_at: Date
  started_at: Date | null
  completed_at: Date | null
  result: unknown
  error: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value)

    return toRecord(parsed)
  }

  return {}
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    type: INGEST_DOCUMENT_JOB_TYPE,
    payload: toRecord(row.payload),
    status: row.status as JobStatus,
    attempts: row.attempts,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    result: row.result === null ? undefined : toRecord(row.result),
    error: row.error ?? undefined,
  }
}

const JOB_COLUMNS = `
  jobs.id,
  jobs.type,
  jobs.payload,
  jobs.status,
  jobs.attempts,
  jobs.created_at,
  jobs.started_at,
  jobs.completed_at,
  jobs.result,
  jobs.error
`

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly pool: Pool) {}

  private query(
    text: string,
    values: readonly unknown[]
  ): Promise<{ rows: JobRow[] }> {
    return this.pool.query<JobRow>(text, [...values])
  }

  private async nextJob(
    text: string,
    values: readonly unknown[]
  ): Promise<Job | null> {
    const { rows } = await this.query(text, values)
    const row = rows[0]

    return row ? toJob(row) : null
  }

  async submitIngestJob(
    documentId: string,
    sessionId: string,
    pdfBytes: Buffer,
    pdfOriginalName: string
  ): Promise<Job> {
    const payload = JSON.stringify({
      documentId,
      sessionId,
      pdfOriginalName,
      pdfByteLength: pdfBytes.byteLength,
      pdfBase64: pdfBytes.toString('base64'),
    })
    const result = await this.query(
      `
        INSERT INTO jobs (id, type, payload, status, created_at)
        VALUES ($1, $2, $3::jsonb, 'pending', now())
        RETURNING ${JOB_COLUMNS}
      `,
      [randomUUID(), INGEST_DOCUMENT_JOB_TYPE, payload]
    )
    const row = result.rows[0]

    if (!row) {
      throw new Error('No se pudo encolar el trabajo de ingesta')
    }

    return toJob(row)
  }

  async getJob(id: string): Promise<Job | null> {
    return this.nextJob(
      `
        SELECT ${JOB_COLUMNS}
        FROM jobs
        WHERE id = $1
      `,
      [id]
    )
  }

  async claimNextJob(): Promise<Job | null> {
    return this.nextJob(
      `
        WITH claimed AS (
          SELECT id
          FROM jobs
          WHERE status = 'pending'
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE jobs
        SET status = 'processing',
            started_at = now(),
            attempts = jobs.attempts + 1
        FROM claimed
        WHERE jobs.id = claimed.id
        RETURNING ${JOB_COLUMNS}
      `,
      []
    )
  }

  async markReady(id: string, result: Record<string, unknown>): Promise<void> {
    await this.query(
      `
        UPDATE jobs
        SET status = 'ready', completed_at = now(), result = $2::jsonb
        WHERE id = $1 AND status = 'processing'
      `,
      [id, JSON.stringify(result)]
    )
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.query(
      `
        UPDATE jobs
        SET status = 'failed', completed_at = now(), error = $2
        WHERE id = $1 AND status = 'processing'
      `,
      [id, error]
    )
  }
}
