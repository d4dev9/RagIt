import {
  assertEmbedding,
  EMBEDDING_DIMENSIONS,
} from '../../domain/documents/embedding'
import type { EmbeddingProvider } from '../../ports/embedding-provider'

const DEFAULT_MODEL = 'gemini-embedding-001'
const BATCH_SIZE = 100
const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export class MissingGeminiApiKeyError extends Error {
  constructor() {
    super('La variable de entorno GEMINI_API_KEY no está definida')
    this.name = 'MissingGeminiApiKeyError'
  }
}

export class GeminiEmbeddingRequestError extends Error {
  constructor(status: number) {
    super(`La API de embeddings de Gemini respondió con estado ${status}`)
    this.name = 'GeminiEmbeddingRequestError'
  }
}

export class InvalidGeminiEmbeddingResponseError extends Error {
  constructor() {
    super('La API de embeddings de Gemini devolvió una respuesta inválida')
    this.name = 'InvalidGeminiEmbeddingResponseError'
  }
}

export interface GeminiEmbeddingProviderOptions {
  readonly apiKey?: string
  readonly model?: string
}

interface GeminiEmbeddingEntry {
  readonly values?: readonly number[]
}

interface GeminiEmbeddingResponse {
  readonly embeddings?: readonly GeminiEmbeddingEntry[]
}

function readApiKey(apiKey: string | undefined): string {
  const resolved = apiKey ?? process.env.GEMINI_API_KEY

  if (!resolved) {
    throw new MissingGeminiApiKeyError()
  }

  return resolved
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string
  private readonly model: string

  constructor(options: GeminiEmbeddingProviderOptions = {}) {
    this.apiKey = readApiKey(options.apiKey)
    this.model = options.model ?? DEFAULT_MODEL
  }

  private async requestBatch(texts: readonly string[]): Promise<number[][]> {
    const response = await fetch(
      `${API_BASE_URL}/models/${this.model}:batchEmbedContents`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        }),
      }
    )

    if (!response.ok) {
      throw new GeminiEmbeddingRequestError(response.status)
    }

    const body = (await response.json()) as GeminiEmbeddingResponse
    const embeddings = body.embeddings

    if (!embeddings || embeddings.length !== texts.length) {
      throw new InvalidGeminiEmbeddingResponseError()
    }

    return embeddings.map((entry) => {
      const values = entry.values

      if (!values) {
        throw new InvalidGeminiEmbeddingResponseError()
      }

      const vector = [...values]
      assertEmbedding(vector)

      return vector
    })
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = []

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE)
      const embeddings = await this.requestBatch(batch)
      vectors.push(...embeddings)
    }

    return vectors
  }
}
