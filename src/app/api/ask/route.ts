import { InvalidQuestionError } from '../../../domain/retrieval/retrieval-errors'
import { EmbeddingModelMismatchError } from '../../../domain/retrieval/retrieval-errors'
import { getPostgresPool } from '../../../infrastructure/database/postgres-pool'
import { MissingDatabaseUrlError } from '../../../infrastructure/database/postgres-pool'
import {
  AnswerModelTimeoutError,
  MissingAnswerModelConfigError,
  OpenAiCompatibleAnswerModel,
} from '../../../infrastructure/answers/openai-compatible-answer-model'
import { PostgresChunkRepository } from '../../../infrastructure/database/postgres-chunk-repository'
import { PostgresSessionRepository } from '../../../infrastructure/database/postgres-session-repository'
import {
  EmbeddingTimeoutError,
  MissingEmbeddingConfigError,
  OpenAiCompatibleEmbeddingProvider,
} from '../../../infrastructure/embeddings/openai-compatible-embedding-provider'
import { getOrCreateApiSession } from '../../../lib/api-session'
import { askQuestion } from '../../../application/ask-question'
import {
  apiError,
  serviceUnavailableResponse,
} from '../../../lib/api-response'
import { createRequestId, logger } from '../../../lib/logger'

function isQuestionBody(
  value: unknown
): value is { readonly question: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'question' in value &&
    typeof value.question === 'string'
  )
}

export async function POST(request: Request): Promise<Response> {
  const requestId = createRequestId()

  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim() !==
    'application/json'
  ) {
    return apiError('La solicitud no es válida', 'INVALID_REQUEST', requestId, 415)
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return apiError('La solicitud no es válida', 'INVALID_REQUEST', requestId, 400)
  }

  if (!isQuestionBody(body)) {
    return apiError('La solicitud no es válida', 'INVALID_REQUEST', requestId, 400)
  }

  try {
    const pool = getPostgresPool()
    const sessionRepository = new PostgresSessionRepository(pool)
    const sessionId = await getOrCreateApiSession(sessionRepository)
    const result = await askQuestion(
      sessionId,
      body.question,
      new PostgresChunkRepository(pool),
      new OpenAiCompatibleEmbeddingProvider(),
      new OpenAiCompatibleAnswerModel()
    )

    return Response.json({ ...result, requestId })
  } catch (error) {
    if (error instanceof InvalidQuestionError) {
      return apiError('La pregunta no es válida', 'INVALID_QUESTION', requestId, 400)
    }

    if (error instanceof EmbeddingModelMismatchError) {
      return apiError(
        'El modelo de embeddings cambió. Ejecuta pnpm reindex antes de preguntar.',
        'REINDEX_REQUIRED',
        requestId,
        409
      )
    }

    if (error instanceof MissingEmbeddingConfigError) {
      logger.error({ event: 'embedding_configuration_missing', requestId, error })

      return serviceUnavailableResponse(requestId)
    }

    if (error instanceof MissingAnswerModelConfigError) {
      logger.error({ event: 'answer_configuration_missing', requestId, error })

      return serviceUnavailableResponse(requestId)
    }

    if (error instanceof MissingDatabaseUrlError) {
      logger.error({ event: 'database_configuration_missing', requestId, error })

      return serviceUnavailableResponse(requestId)
    }

    if (
      error instanceof EmbeddingTimeoutError ||
      error instanceof AnswerModelTimeoutError
    ) {
      logger.error({ event: 'model_provider_timeout', requestId, error })

      return apiError(
        'El proveedor excedió el tiempo de respuesta.',
        'PROVIDER_TIMEOUT',
        requestId,
        504
      )
    }

    logger.error({ event: 'question_answer_failed', requestId, error })

    return apiError(
      'No se pudo responder la pregunta',
      'INTERNAL_ERROR',
      requestId,
      500
    )
  }
}
