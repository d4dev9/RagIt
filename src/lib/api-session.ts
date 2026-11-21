import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { Session } from '../domain/sessions/session'
import { InvalidSessionIdError } from '../domain/sessions/session-errors'
import { SessionId } from '../domain/sessions/session-id'
import type { SessionRepository } from '../ports/sessions/session-repository'

export const SESSION_COOKIE_NAME = 'ragit_session'
export const SESSION_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60

export interface ApiCookieStore {
  get(name: string): { readonly value: string } | undefined
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
  ): void
}

function parseSessionId(value: string | undefined): SessionId | null {
  if (!value) {
    return null
  }

  try {
    return SessionId.create(value)
  } catch (error) {
    if (error instanceof InvalidSessionIdError) {
      return null
    }

    throw error
  }
}

function setSessionCookie(
  cookieStore: ApiCookieStore,
  sessionId: SessionId
): void {
  cookieStore.set(SESSION_COOKIE_NAME, sessionId.toString(), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  })
}

export async function getOrCreateApiSession(
  sessionRepository: SessionRepository,
  providedCookieStore?: ApiCookieStore
): Promise<SessionId> {
  const cookieStore = providedCookieStore ?? (await cookies())
  const now = new Date()
  const existingId = parseSessionId(cookieStore.get(SESSION_COOKIE_NAME)?.value)

  if (existingId) {
    const existing = await sessionRepository.findById(existingId)

    if (existing && !existing.isExpiredAt(now)) {
      existing.touch(now)
      await sessionRepository.save(existing)
      setSessionCookie(cookieStore, existing.id)

      return existing.id
    }
  }

  const session = Session.create(SessionId.create(randomUUID()), now)

  await sessionRepository.save(session)
  setSessionCookie(cookieStore, session.id)

  return session.id
}
