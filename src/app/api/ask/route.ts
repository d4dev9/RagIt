import { InvalidQuestionError } from '../../../domain/retrieval/retrieval-errors'
import { getPostgresPool } from '../../../infrastructure/database/postgres-pool'
import { OpenAiCompatibleAnswerModel } from '../../../infrastructure/answers/openai-compatible-answer-model'
import { PostgresChunkRepository } from '../../../infrastructure/database/postgres-chunk-repository'
import { PostgresSessionRepository } from '../../../infrastructure/database/postgres-session-repository'
import { GeminiEmbeddingProvider } from '../../../infrastructure/embeddings/gemini-embedding-provider'
import { getOrCreateApiSession } from '../../../lib/api-session'
import { askQuestion } from '../../../application/ask-question'

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
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim() !==
    'application/json'
  ) {
    return Response.json(
      { error: 'La solicitud no es válida' },
      { status: 415 }
    )
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'La solicitud no es válida' },
      { status: 400 }
    )
  }

  if (!isQuestionBody(body)) {
    return Response.json(
      { error: 'La solicitud no es válida' },
      { status: 400 }
    )
  }

  try {
    const pool = getPostgresPool()
    const sessionRepository = new PostgresSessionRepository(pool)
    const sessionId = await getOrCreateApiSession(sessionRepository)
    const result = await askQuestion(
      sessionId,
      body.question,
      new PostgresChunkRepository(pool),
      new GeminiEmbeddingProvider(),
      new OpenAiCompatibleAnswerModel()
    )

    return Response.json(result)
  } catch (error) {
    if (error instanceof InvalidQuestionError) {
      return Response.json(
        { error: 'La pregunta no es válida' },
        { status: 400 }
      )
    }

    console.error('Error interno al responder una pregunta')

    return Response.json(
      { error: 'No se pudo responder la pregunta' },
      { status: 500 }
    )
  }
}
