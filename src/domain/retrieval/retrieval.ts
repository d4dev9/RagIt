import { InvalidQuestionError } from './retrieval-errors'

export const MAX_CONTEXT_CHUNKS = 5
export const MAX_CONTEXT_DISTANCE = 0.7
export const MAX_QUESTION_LENGTH = 2000
export const NO_INFORMATION_ANSWER =
  'No encontré esa información en los documentos de esta sesión.'

export interface RetrievedChunk {
  readonly documentId: string
  readonly page: number
  readonly chunkIndex: number
  readonly content: string
  readonly distance: number
}

export interface Citation {
  readonly documentId: string
  readonly page: number
}

export function normalizeQuestion(question: string): string {
  const normalized = question.trim()

  if (normalized.length === 0 || normalized.length > MAX_QUESTION_LENGTH) {
    throw new InvalidQuestionError()
  }

  return normalized
}

export function isRelevantChunk(chunk: RetrievedChunk): boolean {
  const hasContent = chunk.content.trim().length > 0
  const hasValidDistance =
    Number.isFinite(chunk.distance) &&
    chunk.distance >= 0 &&
    chunk.distance <= MAX_CONTEXT_DISTANCE

  return hasContent && hasValidDistance
}

export function selectRelevantChunks(
  chunks: readonly RetrievedChunk[]
): readonly RetrievedChunk[] {
  return chunks
    .filter((chunk) => isRelevantChunk(chunk))
    .slice(0, MAX_CONTEXT_CHUNKS)
}

export function toCitations(
  chunks: readonly RetrievedChunk[]
): readonly Citation[] {
  const seen = new Set<string>()
  const citations: Citation[] = []

  for (const chunk of chunks) {
    const key = `${chunk.documentId}:${chunk.page}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    citations.push({ documentId: chunk.documentId, page: chunk.page })
  }

  return citations
}
