import { assertEmbedding } from '../domain/documents/embedding'
import type { ChunkId } from '../domain/documents/chunk-id'
import { InvalidEmbeddingError } from '../domain/documents/document-errors'
import type { ChunkRepository } from '../ports/documents/chunk-repository'
import type { EmbeddingProvider } from '../ports/embedding-provider'
import type { SessionId } from '../domain/sessions/session-id'

export interface ReindexDependencies {
  readonly chunkRepository: ChunkRepository
  readonly embeddingProvider: EmbeddingProvider
  readonly batchSize?: number
  readonly sessionId?: SessionId
}

export async function reindexEmbeddings(
  deps: ReindexDependencies
): Promise<number> {
  const batchSize = deps.batchSize ?? 100

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('El tamaño del lote debe ser un entero positivo')
  }

  let afterId: ChunkId | null = null
  let updated = 0

  for (;;) {
    const chunks = await deps.chunkRepository.listForReindex(
      afterId,
      batchSize,
      deps.sessionId
    )

    if (chunks.length === 0) {
      return updated
    }

    const embeddings = await deps.embeddingProvider.embed(
      chunks.map((chunk) => chunk.content)
    )

    if (embeddings.length !== chunks.length) {
      throw new InvalidEmbeddingError()
    }

    for (const [index, chunk] of chunks.entries()) {
      const embedding = embeddings[index]

      if (!embedding) {
        throw new InvalidEmbeddingError()
      }

      assertEmbedding(embedding)
      await deps.chunkRepository.updateEmbedding(
        chunk.id,
        embedding,
        deps.embeddingProvider.modelName
      )
      updated += 1
    }

    afterId = chunks[chunks.length - 1]?.id ?? afterId
  }
}
