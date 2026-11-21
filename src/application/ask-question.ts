import { assertEmbedding } from '../domain/documents/embedding'
import { InvalidEmbeddingError } from '../domain/documents/document-errors'
import {
  MAX_CONTEXT_CHUNKS,
  normalizeQuestion,
  NO_INFORMATION_ANSWER,
  selectRelevantChunks,
  toCitations,
} from '../domain/retrieval/retrieval'
import type { Citation, RetrievedChunk } from '../domain/retrieval/retrieval'
import { buildQuestionPrompt } from '../domain/retrieval/prompt'
import type { SessionId } from '../domain/sessions/session-id'
import type { AnswerModel } from '../ports/answer-model'
import type {
  ChunkMatch,
  ChunkRepository,
} from '../ports/documents/chunk-repository'
import type { EmbeddingProvider } from '../ports/embedding-provider'

export interface AskQuestionResult {
  readonly answer: string
  readonly citations: readonly Citation[]
}

function toRetrievedChunk(match: ChunkMatch): RetrievedChunk {
  return {
    documentId: match.documentId.toString(),
    page: match.page,
    chunkIndex: match.index,
    content: match.content,
    distance: match.distance,
  }
}

export async function askQuestion(
  sessionId: SessionId,
  question: string,
  chunkRepository: ChunkRepository,
  embeddingProvider: EmbeddingProvider,
  answerModel: AnswerModel
): Promise<AskQuestionResult> {
  const normalizedQuestion = normalizeQuestion(question)
  const embeddings = await embeddingProvider.embed([normalizedQuestion])
  const questionEmbedding = embeddings[0]

  if (!questionEmbedding) {
    throw new InvalidEmbeddingError()
  }

  assertEmbedding(questionEmbedding)

  const matches = await chunkRepository.searchBySession(
    sessionId,
    questionEmbedding,
    MAX_CONTEXT_CHUNKS
  )
  const chunks = selectRelevantChunks(matches.map(toRetrievedChunk))

  if (chunks.length === 0) {
    return { answer: NO_INFORMATION_ANSWER, citations: [] }
  }

  const prompt = buildQuestionPrompt(normalizedQuestion, chunks)
  const answer = (await answerModel.answer(prompt)).trim()
  const finalAnswer = answer.length > 0 ? answer : NO_INFORMATION_ANSWER

  return {
    answer: finalAnswer,
    citations: toCitations(chunks),
  }
}
