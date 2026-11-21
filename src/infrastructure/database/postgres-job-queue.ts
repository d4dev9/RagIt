import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { DocumentId } from '../../domain/documents/document-id'
import type { SessionId } from '../../domain/sessions/session-id'
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

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly pool: Pool) {}

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
    return this.firstJob(
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
    await this.pool.query(
      `
        UPDATE jobs
        SET status = 'ready', completed_at = now(), result = $2::jsonb
        WHERE id = $1 AND status = 'processing'
      `,
      [id, JSON.stringify(result)]
    )
  }

  async markFailed(id: string, error: string): Promise<void> {
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
