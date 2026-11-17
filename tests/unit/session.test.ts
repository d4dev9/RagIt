import { describe, expect, it } from 'vitest'
import {
  InvalidSessionIdError,
  InvalidSessionTimelineError,
  SessionExpiredError,
} from '../../src/domain/sessions/session-errors'
import { SessionId } from '../../src/domain/sessions/session-id'
import {
  SESSION_INACTIVITY_LIMIT_MS,
  Session,
} from '../../src/domain/sessions/session'

const VALID_UUID = '11111111-1111-4111-8111-111111111111'
const OTHER_VALID_UUID = '22222222-2222-4222-8222-222222222222'

function fixedSessionId(): SessionId {
  return SessionId.create(VALID_UUID)
}

describe('SessionId (F-01)', () => {
  it('acepta un UUID v4 válido', () => {
    const id = SessionId.create(VALID_UUID)
    expect(id.toString()).toBe(VALID_UUID)
  })

  it('normaliza un UUID v4 en mayúsculas a minúsculas', () => {
    const id = SessionId.create('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE')
    expect(id.toString()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })

  it('rechaza un UUID de versión distinta a la 4', () => {
    expect(() =>
      SessionId.create('11111111-1111-1111-8111-111111111111')
    ).toThrow(InvalidSessionIdError)
  })

  it('rechaza un UUID v4 con variante inválida', () => {
    expect(() =>
      SessionId.create('11111111-1111-4111-c111-111111111111')
    ).toThrow(InvalidSessionIdError)
  })

  it('rechaza una cadena que no es un UUID', () => {
    expect(() => SessionId.create('not-a-uuid')).toThrow(InvalidSessionIdError)
  })

  it('compara identificadores por valor', () => {
    const first = fixedSessionId()
    const second = fixedSessionId()
    const other = SessionId.create(OTHER_VALID_UUID)

    expect(first.equals(second)).toBe(true)
    expect(first.equals(other)).toBe(false)
  })
})

describe('Session (F-01)', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z')

  it('crea una sesión con la actividad inicial igual a la creación', () => {
    const session = Session.create(fixedSessionId(), createdAt)

    expect(session.createdAt.toISOString()).toBe(createdAt.toISOString())
    expect(session.lastActivityAt.toISOString()).toBe(createdAt.toISOString())
  })

  it('no queda afectada si se muta la fecha recibida al crear', () => {
    const ahora = new Date('2026-01-01T00:00:00.000Z')
    const session = Session.create(fixedSessionId(), ahora)

    ahora.setTime(0)

    expect(session.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('expone fechas como copias defensivas', () => {
    const session = Session.create(fixedSessionId(), createdAt)

    const expuesta = session.createdAt
    expuesta.setTime(0)

    expect(session.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('calcula la expiración 24 horas después de la última actividad', () => {
    const session = Session.create(fixedSessionId(), createdAt)

    expect(session.expiresAt().toISOString()).toBe('2026-01-02T00:00:00.000Z')
    expect(session.expiresAt().getTime() - createdAt.getTime()).toBe(
      SESSION_INACTIVITY_LIMIT_MS
    )
  })

  it('sigue activa justo antes de las 24 horas de inactividad', () => {
    const session = Session.create(fixedSessionId(), createdAt)
    const justoAntes = new Date('2026-01-01T23:59:59.999Z')

    expect(session.isExpiredAt(justoAntes)).toBe(false)
  })

  it('expira exactamente a las 24 horas de inactividad', () => {
    const session = Session.create(fixedSessionId(), createdAt)
    const justoDespues = new Date('2026-01-02T00:00:00.000Z')

    expect(session.isExpiredAt(justoDespues)).toBe(true)
  })

  it('expira después de las 24 horas de inactividad', () => {
    const session = Session.create(fixedSessionId(), createdAt)
    const muyDespues = new Date('2026-01-03T00:00:00.000Z')

    expect(session.isExpiredAt(muyDespues)).toBe(true)
  })

  it('assertActiveAt no lanza si la sesión está activa', () => {
    const session = Session.create(fixedSessionId(), createdAt)

    expect(() =>
      session.assertActiveAt(new Date('2026-01-01T10:00:00.000Z'))
    ).not.toThrow()
  })

  it('assertActiveAt lanza SessionExpiredError si la sesión expiró', () => {
    const session = Session.create(fixedSessionId(), createdAt)

    expect(() =>
      session.assertActiveAt(new Date('2026-01-02T00:00:00.000Z'))
    ).toThrow(SessionExpiredError)
  })

  it('touch actualiza la última actividad y la expiración', () => {
    const session = Session.create(fixedSessionId(), createdAt)
    const actividad = new Date('2026-01-01T10:00:00.000Z')

    session.touch(actividad)

    expect(session.lastActivityAt.toISOString()).toBe(actividad.toISOString())
    expect(session.expiresAt().toISOString()).toBe('2026-01-02T10:00:00.000Z')
  })

  it('touch no retrocede la última actividad a un instante anterior', () => {
    const session = Session.create(fixedSessionId(), createdAt)
    const actividad = new Date('2026-01-01T10:00:00.000Z')
    session.touch(actividad)

    session.touch(new Date('2026-01-01T09:00:00.000Z'))

    expect(session.lastActivityAt.toISOString()).toBe(actividad.toISOString())
  })

  it('touch lanza SessionExpiredError sobre una sesión expirada', () => {
    const session = Session.create(fixedSessionId(), createdAt)

    expect(() => session.touch(new Date('2026-01-02T00:00:00.000Z'))).toThrow(
      SessionExpiredError
    )
  })

  it('touch lanza InvalidSessionTimelineError si el instante precede la creación', () => {
    const session = Session.create(fixedSessionId(), createdAt)

    expect(() => session.touch(new Date('2025-12-31T23:59:59.999Z'))).toThrow(
      InvalidSessionTimelineError
    )
  })

  it('restore conserva los instantes recibidos', () => {
    const lastActivityAt = new Date('2026-01-01T08:00:00.000Z')

    const session = Session.restore(fixedSessionId(), createdAt, lastActivityAt)

    expect(session.createdAt.toISOString()).toBe(createdAt.toISOString())
    expect(session.lastActivityAt.toISOString()).toBe(
      lastActivityAt.toISOString()
    )
  })

  it('restore rechaza una actividad anterior a la creación', () => {
    expect(() =>
      Session.restore(
        fixedSessionId(),
        createdAt,
        new Date('2025-12-31T23:59:59.999Z')
      )
    ).toThrow(InvalidSessionTimelineError)
  })

  it('expone el identificador recibido', () => {
    const id = SessionId.create(OTHER_VALID_UUID)
    const session = Session.create(id, createdAt)

    expect(session.id.equals(id)).toBe(true)
  })
})
