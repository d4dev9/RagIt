import type { Pool } from 'pg'
import { SESSION_INACTIVITY_LIMIT_MS } from '../../domain/sessions/session'
import { Session } from '../../domain/sessions/session'
import { SessionId } from '../../domain/sessions/session-id'
import type { SessionRepository } from '../../ports/sessions/session-repository'

type SessionRow = {
  id: string
  created_at: Date
  last_activity_at: Date
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async save(session: Session): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO sessions (id, created_at, last_activity_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
        SET last_activity_at = EXCLUDED.last_activity_at
      `,
      [session.id.toString(), session.createdAt, session.lastActivityAt]
    )
  }

  async findById(sessionId: SessionId): Promise<Session | null> {
    const result = await this.pool.query<SessionRow>(
      `
        SELECT id, created_at, last_activity_at
        FROM sessions
        WHERE id = $1
      `,
      [sessionId.toString()]
    )
    const row = result.rows[0]

    if (!row) {
      return null
    }

    return Session.restore(
      SessionId.create(row.id),
      row.created_at,
      row.last_activity_at
    )
  }

  async listExpired(now: Date): Promise<readonly Session[]> {
    const expiresBefore = new Date(now.getTime() - SESSION_INACTIVITY_LIMIT_MS)
    const result = await this.pool.query<SessionRow>(
      `
        SELECT id, created_at, last_activity_at
        FROM sessions
        WHERE last_activity_at <= $1
        ORDER BY last_activity_at ASC, id ASC
      `,
      [expiresBefore]
    )

    return result.rows.map((row) =>
      Session.restore(
        SessionId.create(row.id),
        row.created_at,
        row.last_activity_at
      )
    )
  }

  async delete(sessionId: SessionId): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM sessions WHERE id = $1', [
      sessionId.toString(),
    ])

    return (result.rowCount ?? 0) > 0
  }
}
