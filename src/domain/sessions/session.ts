import {
  InvalidSessionTimelineError,
  SessionExpiredError,
} from './session-errors'
import { SessionId } from './session-id'

export const SESSION_INACTIVITY_LIMIT_MS = 24 * 60 * 60 * 1000

export class Session {
  private constructor(
    private readonly sessionId: SessionId,
    private readonly created: Date,
    private activity: Date
  ) {}

  static create(sessionId: SessionId, now: Date): Session {
    const wallClock = new Date(now.getTime())

    return new Session(sessionId, wallClock, new Date(wallClock.getTime()))
  }

  static restore(
    sessionId: SessionId,
    createdAt: Date,
    lastActivityAt: Date
  ): Session {
    if (lastActivityAt.getTime() < createdAt.getTime()) {
      throw new InvalidSessionTimelineError()
    }

    return new Session(
      sessionId,
      new Date(createdAt.getTime()),
      new Date(lastActivityAt.getTime())
    )
  }

  get id(): SessionId {
    return this.sessionId
  }

  get createdAt(): Date {
    return new Date(this.created.getTime())
  }

  get lastActivityAt(): Date {
    return new Date(this.activity.getTime())
  }

  expiresAt(): Date {
    return new Date(this.activity.getTime() + SESSION_INACTIVITY_LIMIT_MS)
  }

  isExpiredAt(now: Date): boolean {
    return (
      now.getTime() - this.activity.getTime() >= SESSION_INACTIVITY_LIMIT_MS
    )
  }

  assertActiveAt(now: Date): void {
    if (this.isExpiredAt(now)) {
      throw new SessionExpiredError()
    }
  }

  touch(now: Date): void {
    if (now.getTime() < this.created.getTime()) {
      throw new InvalidSessionTimelineError()
    }

    this.assertActiveAt(now)

    if (now.getTime() > this.activity.getTime()) {
      this.activity = new Date(now.getTime())
    }
  }
}
