import type { AnswerModel, AnswerModelRequest } from '../../ports/answer-model'

export const ANSWER_MODEL_TIMEOUT_MS = 60_000

export class MissingAnswerModelConfigError extends Error {
  readonly variable: string

  constructor(variable: string) {
    super(`Falta la variable de entorno ${variable}`)
    this.name = 'MissingAnswerModelConfigError'
    this.variable = variable
  }
}

export class AnswerModelRequestError extends Error {
  constructor(status: number) {
    super(`El modelo de respuesta respondió con estado ${status}`)
    this.name = 'AnswerModelRequestError'
  }
}

export class InvalidAnswerModelResponseError extends Error {
  constructor() {
    super('El modelo de respuesta devolvió una respuesta inválida')
    this.name = 'InvalidAnswerModelResponseError'
  }
}

export class AnswerModelTimeoutError extends Error {
  constructor() {
    super('La solicitud al modelo de respuesta excedió el tiempo límite')
    this.name = 'AnswerModelTimeoutError'
  }
}

export interface OpenAiCompatibleAnswerModelOptions {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly model?: string
}

interface ChatCompletionChoice {
  readonly message?: {
    readonly content?: unknown
  }
}

interface ChatCompletionResponse {
  readonly choices?: readonly ChatCompletionChoice[]
}

function required(explicit: string | undefined, variable: string): string {
  const value = explicit ?? process.env[variable]

  if (!value) {
    throw new MissingAnswerModelConfigError(variable)
  }

  return value
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

export class OpenAiCompatibleAnswerModel implements AnswerModel {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string

  constructor(options: OpenAiCompatibleAnswerModelOptions = {}) {
    this.apiKey = required(options.apiKey, 'ANSWER_MODEL_API_KEY')
    this.baseUrl = required(options.baseUrl, 'ANSWER_MODEL_BASE_URL').replace(
      /\/+$/,
      ''
    )
    this.model = required(options.model, 'ANSWER_MODEL_NAME')
  }

  async answer(request: AnswerModelRequest): Promise<string> {
    let response: Response
    const signal = AbortSignal.timeout(ANSWER_MODEL_TIMEOUT_MS)

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
        }),
        signal,
      })
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new AnswerModelTimeoutError()
      }

      throw error
    }

    if (!response.ok) {
      throw new AnswerModelRequestError(response.status)
    }

    let body: unknown

    try {
      body = await response.json()
    } catch (error) {
      if (signal.aborted || isTimeoutError(error)) {
        throw new AnswerModelTimeoutError()
      }

      throw error
    }

    if (!isChatCompletionResponse(body)) {
      throw new InvalidAnswerModelResponseError()
    }

    const content = body.choices?.[0]?.message?.content

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new InvalidAnswerModelResponseError()
    }

    return content
  }
}

function isChatCompletionResponse(
  value: unknown
): value is ChatCompletionResponse {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
