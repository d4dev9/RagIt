import type { Session } from '../../domain/sessions/session'
import type { SessionId } from '../../domain/sessions/session-id'

export interface SessionRepository {
  save(session: Session): Promise<void>
  findById(sessionId: SessionId): Promise<Session | null>
  delete(sessionId: SessionId): Promise<boolean>
}
