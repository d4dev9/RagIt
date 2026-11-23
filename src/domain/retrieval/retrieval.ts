import { InvalidQuestionError } from './retrieval-errors'

export const MAX_CONTEXT_CHUNKS = 5
export const MAX_CONTEXT_DISTANCE = 0.7
export const MAX_QUESTION_LENGTH = 2000
export const NO_INFORMATION_ANSWER =
  'No encontré esa información en los documentos de esta sesión.'

export interface RetrievedChunk {
  readonly documentId: string
  readonly displayName: string
  readonly page: number
  readonly chunkIndex: number
  readonly content: string
  readonly distance: number
}

export interface Citation {
  readonly index: number
  readonly documentId: string
  readonly displayName: string
  readonly page: number
}

export interface ResolvedAnswer {
  readonly answer: string
  readonly citations: readonly Citation[]
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

export function resolveAnswer(
  answer: string,
  chunks: readonly RetrievedChunk[]
): ResolvedAnswer {
  const chunksByIndex = new Map(
    chunks.map((chunk, index) => [index + 1, chunk])
  )
  const usedIndexes = new Set<number>()
  const withValidMarkers = answer.replace(/\[(\d+)\]/g, (marker, value: string) => {
    const index = Number(value)

    if (!chunksByIndex.has(index)) {
      return ''
    }

    usedIndexes.add(index)

    return marker
  })
  const sanitizedAnswer = withValidMarkers
    .replace(/\[documento\s*:[^\]]*\]/gi, '')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  const citations: Citation[] = []

  for (const index of usedIndexes) {
    const chunk = chunksByIndex.get(index)

    if (chunk) {
      citations.push({
        index,
        documentId: chunk.documentId,
        displayName: chunk.displayName,
        page: chunk.page,
      })
    }
  }

  return { answer: sanitizedAnswer, citations }
}
