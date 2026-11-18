import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { SessionId } from '../../src/domain/sessions/session-id'
import { PostgresSessionRepository } from '../../src/infrastructure/database/postgres-session-repository'
import {
  createAppPool,
  createSession,
  integrationEnabled,
  migrateDatabase,
} from './test-database'

describe.skipIf(!integrationEnabled)('PostgresSessionRepository', () => {
  let pool: Pool
  let repository: PostgresSessionRepository
  const created: SessionId[] = []

  beforeAll(async () => {
    await migrateDatabase()
    pool = createAppPool()
    repository = new PostgresSessionRepository(pool)
  })

  afterAll(async () => {
    for (const sessionId of created) {
      await repository.delete(sessionId)
    }

    await pool.end()
  })

  async function saveSession(): Promise<ReturnType<typeof createSession>> {
    const session = createSession()
    await repository.save(session)
    created.push(session.id)

    return session
  }

  it('guarda y recupera una sesión', async () => {
    const session = await saveSession()
    const found = await repository.findById(session.id)

    expect(found?.id.toString()).toBe(session.id.toString())
    expect(found?.createdAt.getTime()).toBe(session.createdAt.getTime())
    expect(found?.lastActivityAt.getTime()).toBe(
      session.lastActivityAt.getTime()
    )
  })

  it('actualiza la última actividad al guardar una sesión tocada', async () => {
    const session = await saveSession()
    const nextActivity = new Date(session.lastActivityAt.getTime() + 60_000)
    session.touch(nextActivity)
    await repository.save(session)
    const found = await repository.findById(session.id)

    expect(found?.lastActivityAt.getTime()).toBe(nextActivity.getTime())
  })

  it('devuelve null para una sesión inexistente', async () => {
    const missing = SessionId.create(randomUUID())

    expect(await repository.findById(missing)).toBeNull()
  })

  it('elimina una sesión existente', async () => {
    const session = await saveSession()

    expect(await repository.delete(session.id)).toBe(true)
    expect(await repository.findById(session.id)).toBeNull()
    expect(await repository.delete(session.id)).toBe(false)
  })
})
