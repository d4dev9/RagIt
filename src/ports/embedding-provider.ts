export interface EmbeddingProvider {
  readonly modelName: string
  embed(texts: string[]): Promise<number[][]>
}
