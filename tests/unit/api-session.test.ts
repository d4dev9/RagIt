import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Session } from '../../src/domain/sessions/session'
import { SessionId } from '../../src/domain/sessions/session-id'
import {
  getOrCreateApiSession,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
} from '../../src/lib/api-session'
import type { ApiCookieStore } from '../../src/lib/api-session'
import type { SessionRepository } from '../../src/ports/sessions/session-repository'

class FakeCookieStore implements ApiCookieStore {
  private readonly values = new Map<string, string>()
  readonly options: Array<{
    readonly httpOnly: true
    readonly secure: true
    readonly sameSite: 'strict'
    readonly path: '/'
    readonly maxAge: number
  }> = []

  get(name: string): { readonly value: string } | undefined {
    const value = this.values.get(name)

    return value ? { value } : undefined
  }

  set(
    name: string,
    value: string,
    options: {
      readonly httpOnly: true
      readonly secure: true
      readonly sameSite: 'strict'
      readonly path: '/'
      readonly maxAge: number
    }
  ): void {
    this.values.set(name, value)
    this.options.push(options)
  }
}

class FakeSessionRepository implements SessionRepository {
  readonly sessions = new Map<string, Session>()

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id.toString(), session)
  }

  async findById(sessionId: SessionId): Promise<Session | null> {
    return this.sessions.get(sessionId.toString()) ?? null
  }

  async listExpired(): Promise<readonly Session[]> {
    return []
  }

  async delete(sessionId: SessionId): Promise<boolean> {
    return this.sessions.delete(sessionId.toString())
  }
}

describe('getOrCreateApiSession (F-01)', () => {
  it('creates a server-generated UUID v4 and sets a secure HttpOnly cookie', async () => {
    const cookies = new FakeCookieStore()
    const repository = new FakeSessionRepository()

    const sessionId = await getOrCreateApiSession(repository, cookies)
    const cookieOptions = cookies.options[0]

    expect(sessionId.toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(cookies.get(SESSION_COOKIE_NAME)?.value).toBe(sessionId.toString())
    expect(cookieOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    })
    expect(repository.sessions.has(sessionId.toString())).toBe(true)
  })

  it('reuses and refreshes an active session from its cookie', async () => {
    const cookies = new FakeCookieStore()
    const repository = new FakeSessionRepository()
    const id = SessionId.create(randomUUID())
    const original = Session.create(id, new Date(Date.now() - 1000))
    const originalActivityAt = original.lastActivityAt.getTime()
    await repository.save(original)
    cookies.set(SESSION_COOKIE_NAME, id.toString(), {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    })
    cookies.options.length = 0

    const result = await getOrCreateApiSession(repository, cookies)

    expect(result.equals(id)).toBe(true)
    expect(repository.sessions.size).toBe(1)
    expect(
      repository.sessions.get(id.toString())?.lastActivityAt.getTime()
    ).toBeGreaterThan(originalActivityAt)
    expect(cookies.options).toHaveLength(1)
  })

  it('replaces an expired session cookie', async () => {
    const cookies = new FakeCookieStore()
    const repository = new FakeSessionRepository()
    const expiredId = SessionId.create(randomUUID())
    const expired = Session.create(
      expiredId,
      new Date(Date.now() - 24 * 60 * 60 * 1000)
    )
    await repository.save(expired)
    cookies.set(SESSION_COOKIE_NAME, expiredId.toString(), {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    })

    const result = await getOrCreateApiSession(repository, cookies)

    expect(result.equals(expiredId)).toBe(false)
    expect(cookies.get(SESSION_COOKIE_NAME)?.value).toBe(result.toString())
    expect(repository.sessions.has(result.toString())).toBe(true)
  })

  it('replaces a malformed session cookie', async () => {
    const cookies = new FakeCookieStore()
    cookies.set(SESSION_COOKIE_NAME, 'invalid', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    })

    const result = await getOrCreateApiSession(
      new FakeSessionRepository(),
      cookies
    )

    expect(cookies.get(SESSION_COOKIE_NAME)?.value).toBe(result.toString())
  })
})
