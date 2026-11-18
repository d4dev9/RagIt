import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ChunkId } from '../../src/domain/documents/chunk-id'
import { DocumentId } from '../../src/domain/documents/document-id'
import {
  EMBEDDING_DIMENSIONS,
  assertEmbedding,
} from '../../src/domain/documents/embedding'
import {
  InvalidChunkIdError,
  InvalidDocumentIdError,
  InvalidEmbeddingError,
} from '../../src/domain/documents/document-errors'

function embeddingWith(value: number): readonly number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => value)
}

describe('DocumentId', () => {
  it('normaliza un UUID v4 válido', () => {
    const raw = randomUUID().toUpperCase()
    const id = DocumentId.create(raw)

    expect(id.toString()).toBe(raw.toLowerCase())
  })

  it('compara identificadores equivalentes', () => {
    const raw = randomUUID()

    expect(DocumentId.create(raw).equals(DocumentId.create(raw))).toBe(true)
  })

  it('rechaza valores que no son UUID v4', () => {
    expect(() => DocumentId.create('documento-1')).toThrow(
      InvalidDocumentIdError
    )
  })
})

describe('ChunkId', () => {
  it('normaliza un UUID v4 válido', () => {
    const raw = randomUUID().toUpperCase()
    const id = ChunkId.create(raw)

    expect(id.toString()).toBe(raw.toLowerCase())
  })

  it('compara identificadores equivalentes', () => {
    const raw = randomUUID()

    expect(ChunkId.create(raw).equals(ChunkId.create(raw))).toBe(true)
  })

  it('rechaza valores que no son UUID v4', () => {
    expect(() => ChunkId.create('chunk-1')).toThrow(InvalidChunkIdError)
  })
})

describe('assertEmbedding', () => {
  it('acepta un vector de 768 dimensiones finitas', () => {
    expect(() => assertEmbedding(embeddingWith(0.5))).not.toThrow()
  })

  it('rechaza una dimensión distinta de 768', () => {
    expect(() => assertEmbedding(embeddingWith(0.5).slice(1))).toThrow(
      InvalidEmbeddingError
    )
  })

  it('rechaza valores no finitos', () => {
    const embedding = [...embeddingWith(0.5)]
    embedding[0] = Number.NaN

    expect(() => assertEmbedding(embedding)).toThrow(InvalidEmbeddingError)
  })
})
