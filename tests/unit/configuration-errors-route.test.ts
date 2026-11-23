import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routeMocks = vi.hoisted(() => ({
  getPostgresPool: vi.fn(() => ({})),
  getOrCreateApiSession: vi.fn(async () => 'test-session'),
}))

vi.mock('../../src/infrastructure/database/postgres-pool', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../src/infrastructure/database/postgres-pool')
    >()

  return {
    ...actual,
    getPostgresPool: routeMocks.getPostgresPool,
  }
})

vi.mock('../../src/lib/api-session', () => ({
  getOrCreateApiSession: routeMocks.getOrCreateApiSession,
}))

import { POST as askQuestionRoute } from '../../src/app/api/ask/route'
import { POST as uploadDocumentRoute } from '../../src/app/api/documents/route'
import { MissingEmbeddingConfigError } from '../../src/infrastructure/embeddings/openai-compatible-embedding-provider'
import { MissingDatabaseUrlError } from '../../src/infrastructure/database/postgres-pool'
import { logger } from '../../src/lib/logger'

const originalEmbeddingApiKey = process.env.EMBEDDING_API_KEY

function askRequest(): Request {
  return new Request('https://localhost/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '¿Cuál es el total?' }),
  })
}

describe('rutas con configuración ausente', () => {
  beforeEach(() => {
    delete process.env.EMBEDDING_API_KEY
    routeMocks.getPostgresPool.mockReset()
    routeMocks.getPostgresPool.mockReturnValue({})
    routeMocks.getOrCreateApiSession.mockReset()
    routeMocks.getOrCreateApiSession.mockResolvedValue('test-session')
  })

  afterEach(() => {
    if (originalEmbeddingApiKey === undefined) {
      delete process.env.EMBEDDING_API_KEY
    } else {
      process.env.EMBEDDING_API_KEY = originalEmbeddingApiKey
    }

    vi.restoreAllMocks()
  })

  it('no revela la variable faltante y responde con SERVICE_UNAVAILABLE', async () => {
    const response = await askQuestionRoute(askRequest())
    const body: unknown = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      error: 'El servicio no está disponible en este momento. Inténtalo más tarde.',
      code: 'SERVICE_UNAVAILABLE',
    })
    expect(JSON.stringify(body)).not.toContain('EMBEDDING_API_KEY')
  })

  it('registra la variable faltante en el logger con evento y requestId', async () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const response = await askQuestionRoute(askRequest())
    const body = (await response.json()) as { requestId: string }
    const entry = logError.mock.calls[0]?.[0]

    expect(entry).toMatchObject({
      event: 'embedding_configuration_missing',
      requestId: body.requestId,
    })
    expect(entry?.error).toBeInstanceOf(MissingEmbeddingConfigError)
    expect(entry?.error).toHaveProperty('variable', 'EMBEDDING_API_KEY')
  })

  it('mapea la ausencia de DATABASE_URL en subida al mismo error seguro', async () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    routeMocks.getPostgresPool.mockImplementationOnce(() => {
      throw new MissingDatabaseUrlError()
    })

    const response = await uploadDocumentRoute(
      new Request('https://localhost/api/documents', { method: 'POST' })
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      error: 'El servicio no está disponible en este momento. Inténtalo más tarde.',
      code: 'SERVICE_UNAVAILABLE',
    })
    expect(JSON.stringify(body)).not.toContain('DATABASE_URL')
    expect(logError.mock.calls[0]?.[0]).toMatchObject({
      event: 'database_configuration_missing',
    })
  })
})
