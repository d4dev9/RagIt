import type { AnswerModel, AnswerModelRequest } from '../../ports/answer-model'

const DEFAULT_TIMEOUT_MS = 30000

export class MissingAnswerModelConfigError extends Error {
  constructor() {
    super(
      'Faltan variables de entorno del modelo de respuesta: ANSWER_MODEL_API_KEY, ANSWER_MODEL_BASE_URL o ANSWER_MODEL_NAME'
    )
    this.name = 'MissingAnswerModelConfigError'
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

export interface OpenAiCompatibleAnswerModelOptions {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly model?: string
  readonly timeoutMs?: number
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
    throw new MissingAnswerModelConfigError()
  }

  return value
}

export class OpenAiCompatibleAnswerModel implements AnswerModel {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(options: OpenAiCompatibleAnswerModelOptions = {}) {
    this.apiKey = required(options.apiKey, 'ANSWER_MODEL_API_KEY')
    this.baseUrl = required(options.baseUrl, 'ANSWER_MODEL_BASE_URL').replace(
      /\/+$/,
      ''
    )
    this.model = required(options.model, 'ANSWER_MODEL_NAME')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async answer(request: AnswerModelRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
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
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      throw new AnswerModelRequestError(response.status)
    }

    const body = (await response.json()) as ChatCompletionResponse
    const content = body.choices?.[0]?.message?.content

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new InvalidAnswerModelResponseError()
    }

    return content
  }
}
