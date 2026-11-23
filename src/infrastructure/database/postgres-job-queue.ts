import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { DocumentId } from '../../domain/documents/document-id'
import type { SessionId } from '../../domain/sessions/session-id'
import type { IngestionFailureCode } from '../../domain/documents/ingestion-failure'
import type {
  IngestDocumentJobPayload,
  Job,
  JobQueue,
  JobStatus,
} from '../../ports/job-queue'
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
    return toRecord(JSON.parse(value) as unknown)
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

const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000
const DEFAULT_MAX_ATTEMPTS = 3
const MAX_ATTEMPT_ERROR: IngestionFailureCode = 'UNKNOWN'

export class InvalidJobQueueConfigError extends Error {
  readonly variable: string

  constructor(variable: string) {
    super(`La variable ${variable} debe ser un entero positivo`)
    this.name = 'InvalidJobQueueConfigError'
    this.variable = variable
  }
}

export interface PostgresJobQueueOptions {
  readonly staleAfterMs?: number
  readonly maxAttempts?: number
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  variable: string
): number {
  if (value === undefined || value.length === 0) {
    return fallback
  }

  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidJobQueueConfigError(variable)
  }

  return parsed
}

function toPayload(value: unknown): Record<string, unknown> {
  return toRecord(value)
}

export class PostgresJobQueue implements JobQueue {
  private readonly staleAfterMs: number
  private readonly maxAttempts: number

  constructor(
    private readonly pool: Pool,
    options: PostgresJobQueueOptions = {}
  ) {
    this.staleAfterMs =
      options.staleAfterMs ??
      readPositiveInteger(
        process.env.JOB_PROCESSING_TIMEOUT_MS,
        DEFAULT_STALE_AFTER_MS,
        'JOB_PROCESSING_TIMEOUT_MS'
      )
    this.maxAttempts =
      options.maxAttempts ??
      readPositiveInteger(
        process.env.JOB_MAX_ATTEMPTS,
        DEFAULT_MAX_ATTEMPTS,
        'JOB_MAX_ATTEMPTS'
      )
  }

  private async firstJob(text: string, values: readonly unknown[]): Promise<Job | null> {
    const result = await this.pool.query<JobRow>(text, [...values])
    const row = result.rows[0]

    return row ? toJob(row) : null
  }

  async submitIngestJob(payload: IngestDocumentJobPayload): Promise<Job> {
    const result = await this.pool.query<JobRow>(
      `
        INSERT INTO jobs (id, type, payload, status, created_at)
        VALUES ($1, $2, $3::jsonb, 'pending', now())
        RETURNING ${JOB_COLUMNS}
      `,
      [
        randomUUID(),
        INGEST_DOCUMENT_JOB_TYPE,
        JSON.stringify({
          documentId: payload.documentId,
          sessionId: payload.sessionId,
          storagePath: payload.storagePath,
          pdfByteLength: payload.pdfByteLength,
        }),
      ]
    )
    const row = result.rows[0]

    if (!row) {
      throw new Error('No se pudo encolar el trabajo de ingesta')
    }

    return toJob(row)
  }

  async getJob(id: string): Promise<Job | null> {
    return this.firstJob(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = $1`, [id])
  }

  async claimNextJob(): Promise<Job | null> {
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const staleJobs = await client.query<{
        payload: unknown
        status: JobStatus
      }>(
        `
          UPDATE jobs
          SET status = CASE
                WHEN attempts >= $2 THEN 'failed'
                ELSE 'pending'
              END,
              started_at = NULL,
              completed_at = CASE
                WHEN attempts >= $2 THEN now()
                ELSE NULL
              END,
              error = CASE
                WHEN attempts >= $2 THEN $3
                ELSE NULL
              END
          WHERE id IN (
            SELECT id
            FROM jobs
            WHERE status = 'processing'
              AND started_at < now() - ($1::double precision * interval '1 millisecond')
            FOR UPDATE SKIP LOCKED
          )
          RETURNING payload, status
        `,
        [this.staleAfterMs, this.maxAttempts, MAX_ATTEMPT_ERROR]
      )

      for (const job of staleJobs.rows) {
        if (job.status !== 'failed') {
          continue
        }

        const payload = toPayload(job.payload)
        const documentId = payload.documentId
        const sessionId = payload.sessionId

        if (typeof documentId === 'string' && typeof sessionId === 'string') {
          await client.query(
            `
              UPDATE documents
              SET status = 'failed', updated_at = now()
              WHERE id::text = $1 AND session_id::text = $2
            `,
            [documentId, sessionId]
          )
        }
      }

      const claimed = await client.query<JobRow>(
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

      await client.query('COMMIT')

      const row = claimed.rows[0]

      return row ? toJob(row) : null
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async markReady(id: string, result: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `
        UPDATE jobs
        SET status = 'ready', completed_at = now(), result = $2::jsonb
        WHERE id = $1 AND status = 'processing'
      `,
      [id, JSON.stringify(result)]
    )
  }

  async markFailed(
    id: string,
    error: IngestionFailureCode
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE jobs
        SET status = 'failed', completed_at = now(), error = $2
        WHERE id = $1 AND status = 'processing'
      `,
      [id, error]
    )
  }

  async deleteByDocument(
    sessionId: SessionId,
    documentId: DocumentId
  ): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM jobs
        WHERE type = $1
          AND payload->>'sessionId' = $2
          AND payload->>'documentId' = $3
      `,
      [INGEST_DOCUMENT_JOB_TYPE, sessionId.toString(), documentId.toString()]
    )
  }

  async deleteBySession(sessionId: SessionId): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM jobs
        WHERE type = $1 AND payload->>'sessionId' = $2
      `,
      [INGEST_DOCUMENT_JOB_TYPE, sessionId.toString()]
    )
  }
}
