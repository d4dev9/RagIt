import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InvalidEmbeddingResponseError,
  OpenAiCompatibleEmbeddingProvider,
} from '../../src/infrastructure/embeddings/openai-compatible-embedding-provider'

function vector(value: number, dimensions = 768): number[] {
  return Array.from({ length: dimensions }, () => value)
}

describe('OpenAiCompatibleEmbeddingProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('conserva el orden de data cuando la respuesta no incluye index', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [
            { embedding: vector(3) },
            { embedding: vector(1) },
            { embedding: vector(2) },
          ],
        }),
        { status: 200 }
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OpenAiCompatibleEmbeddingProvider({
      apiKey: 'test-key',
      baseUrl: 'https://embedding.example',
      modelName: 'test-model',
    })

    const embeddings = await provider.embed(['primero', 'segundo', 'tercero'])

    expect(embeddings.map((embedding) => embedding[0])).toEqual([3, 1, 2])
    expect(embeddings.every((embedding) => embedding.length === 768)).toBe(true)
  })

  it('incluye un detalle legible si la respuesta tiene una dimensión incorrecta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ data: [{ embedding: vector(1, 3072) }] }),
          { status: 200 }
        )
      })
    )
    const provider = new OpenAiCompatibleEmbeddingProvider({
      apiKey: 'test-key',
      baseUrl: 'https://embedding.example',
      modelName: 'test-model',
    })

    await expect(provider.embed(['texto'])).rejects.toMatchObject({
      name: 'InvalidEmbeddingResponseError',
      detail: 'dimensión 3072 distinta de 768',
    } satisfies Partial<InvalidEmbeddingResponseError>)
  })
})
