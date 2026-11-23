export class InvalidQuestionError extends Error {
  constructor() {
    super('La pregunta está vacía o excede el máximo permitido')
    this.name = 'InvalidQuestionError'
  }
}

export class EmbeddingModelMismatchError extends Error {
  constructor() {
    super('El modelo de embeddings cambió. Ejecuta pnpm reindex antes de preguntar.')
    this.name = 'EmbeddingModelMismatchError'
  }
}
