import { InvalidEmbeddingError } from './document-errors'

export const EMBEDDING_DIMENSIONS = 768

export function assertEmbedding(embedding: readonly number[]): void {
  const validDimensions = embedding.length === EMBEDDING_DIMENSIONS
  const validValues = embedding.every((value) => Number.isFinite(value))

  if (!validDimensions || !validValues) {
    throw new InvalidEmbeddingError()
  }
}
