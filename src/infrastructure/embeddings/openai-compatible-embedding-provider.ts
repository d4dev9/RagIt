import {
  assertEmbedding,
  EMBEDDING_DIMENSIONS,
} from '../../domain/documents/embedding'
import type { EmbeddingProvider } from '../../ports/embedding-provider'

const DEFAULT_TIMEOUT_MS = 30000
const BATCH_SIZE = 100

export class MissingEmbeddingConfigError extends Error {
  readonly variable: string

  constructor(variable: string) {
    super(`Falta la variable de entorno ${variable}`)
    this.name = 'MissingEmbeddingConfigError'
    this.variable = variable
  }
}

export class EmbeddingRequestError extends Error {
  constructor(status: number) {
    super(`La API de embeddings respondió con estado ${status}`)
    this.name = 'EmbeddingRequestError'
  }
}

export class InvalidEmbeddingResponseError extends Error {
  readonly detail: string

  constructor(modelName: string, detail: string) {
    super(
      `El modelo configurado en EMBEDDING_MODEL_NAME (${modelName}) no devolvió embeddings válidos de ${EMBEDDING_DIMENSIONS} dimensiones: ${detail}`
    )
    this.name = 'InvalidEmbeddingResponseError'
    this.detail = detail
  }
}

export class EmbeddingTimeoutError extends Error {
  constructor() {
    super('La solicitud al proveedor de embeddings excedió el tiempo límite')
    this.name = 'EmbeddingTimeoutError'
  }
}

export interface OpenAiCompatibleEmbeddingProviderOptions {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly modelName?: string
  readonly timeoutMs?: number
}

function required(value: string | undefined, variable: string): string {
  const resolved = value ?? process.env[variable]

  if (!resolved) {
    throw new MissingEmbeddingConfigError(variable)
  }

  return resolved
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(options: OpenAiCompatibleEmbeddingProviderOptions = {}) {
    this.apiKey = required(options.apiKey, 'EMBEDDING_API_KEY')
    this.baseUrl = required(options.baseUrl, 'EMBEDDING_BASE_URL').replace(
      /\/+$/,
      ''
    )
    this.modelName = required(options.modelName, 'EMBEDDING_MODEL_NAME')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  private async requestBatch(texts: readonly string[]): Promise<number[][]> {
    let response: Response
    const signal = AbortSignal.timeout(this.timeoutMs)

    try {
      response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
        signal,
      })
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new EmbeddingTimeoutError()
      }

      throw error
    }

    if (!response.ok) {
      throw new EmbeddingRequestError(response.status)
    }

    let body: unknown

    try {
      body = await response.json()
    } catch (error) {
      if (signal.aborted || isTimeoutError(error)) {
        throw new EmbeddingTimeoutError()
      }

      throw error
    }

    if (!isRecord(body) || !Array.isArray(body.data)) {
      throw new InvalidEmbeddingResponseError(
        this.modelName,
        'falta el arreglo de datos'
      )
    }

    const entries: readonly unknown[] = body.data

    if (entries.length !== texts.length) {
      throw new InvalidEmbeddingResponseError(
        this.modelName,
        `cantidad de vectores ${entries.length} distinta de textos ${texts.length}`
      )
    }

    const indexed: Array<{ index: number; embedding: number[] }> = []

    for (const [position, value] of entries.entries()) {
      if (!isRecord(value)) {
        throw new InvalidEmbeddingResponseError(
          this.modelName,
          `la entrada ${position} no es válida`
        )
      }

      const index =
        typeof value.index === 'number' ? value.index : position

      if (
        typeof value.index === 'number' &&
        (!Number.isInteger(index) || index < 0 || index >= texts.length)
      ) {
        throw new InvalidEmbeddingResponseError(
          this.modelName,
          `índice ${index} no válido`
        )
      }

      if (
        !Array.isArray(value.embedding) ||
        !value.embedding.every(
          (component): component is number =>
            typeof component === 'number' && Number.isFinite(component)
        )
      ) {
        throw new InvalidEmbeddingResponseError(
          this.modelName,
          `el vector en la posición ${position} no es válido`
        )
      }

      const embedding = value.embedding

      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new InvalidEmbeddingResponseError(
          this.modelName,
          `dimensión ${embedding.length} distinta de ${EMBEDDING_DIMENSIONS}`
        )
      }

      try {
        assertEmbedding(embedding)
      } catch {
        throw new InvalidEmbeddingResponseError(
          this.modelName,
          `el vector en la posición ${position} no es válido`
        )
      }

      indexed.push({ index, embedding: [...embedding] })
    }

    indexed.sort((left, right) => left.index - right.index)

    if (indexed.some((entry, index) => entry.index !== index)) {
      throw new InvalidEmbeddingResponseError(
        this.modelName,
        'los índices están duplicados o incompletos'
      )
    }

    return indexed.map((entry) => entry.embedding)
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = []

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE)
      vectors.push(...(await this.requestBatch(batch)))
    }

    return vectors
  }
}
