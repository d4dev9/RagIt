import { InvalidChunkMetadataError } from './document-errors'

export const MAX_CHUNK_LENGTH = 800
export const CHUNK_OVERLAP = 100

export interface ChunkSource {
  readonly documentId: string
  readonly sessionId: string
  readonly page: number
}

export interface TextChunk extends ChunkSource {
  readonly index: number
  readonly content: string
}

const HIGH_SURROGATE_MIN = 0xd800
const HIGH_SURROGATE_MAX = 0xdbff
const LOW_SURROGATE_MIN = 0xdc00
const LOW_SURROGATE_MAX = 0xdfff

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX
}

function assertChunkSource(source: ChunkSource): void {
  const hasDocument = source.documentId.trim().length > 0
  const hasSession = source.sessionId.trim().length > 0
  const hasValidPage = Number.isInteger(source.page) && source.page > 0

  if (!hasDocument || !hasSession || !hasValidPage) {
    throw new InvalidChunkMetadataError()
  }
}

export function splitTextIntoChunks(
  text: string,
  source: ChunkSource
): readonly TextChunk[] {
  assertChunkSource(source)

  const chunks: TextChunk[] = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(start + MAX_CHUNK_LENGTH, text.length)

    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) {
      end -= 1
    }

    chunks.push({
      documentId: source.documentId,
      sessionId: source.sessionId,
      page: source.page,
      index: chunks.length,
      content: text.slice(start, end),
    })

    if (end >= text.length) {
      break
    }

    start = end - CHUNK_OVERLAP

    if (isLowSurrogate(text.charCodeAt(start))) {
      start += 1
    }
  }

  return chunks
}
