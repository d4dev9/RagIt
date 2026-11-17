import { describe, expect, it } from 'vitest'
import { InvalidChunkMetadataError } from '../../src/domain/documents/document-errors'
import {
  CHUNK_OVERLAP,
  MAX_CHUNK_LENGTH,
  type ChunkSource,
  splitTextIntoChunks,
} from '../../src/domain/documents/text-chunking'

const source: ChunkSource = {
  documentId: 'document-1',
  sessionId: 'session-1',
  page: 3,
}

function hasUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)

      if (next < 0xdc00 || next > 0xdfff) {
        return true
      }

      index += 1
      continue
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }

  return false
}

describe('splitTextIntoChunks (F-04)', () => {
  it('define fragmentos de hasta 800 caracteres', () => {
    expect(MAX_CHUNK_LENGTH).toBe(800)
  })

  it('define un solape de 100 caracteres', () => {
    expect(CHUNK_OVERLAP).toBe(100)
  })

  it('devuelve una lista vacía para texto vacío', () => {
    expect(splitTextIntoChunks('', source)).toEqual([])
  })

  it('devuelve un único fragmento para texto corto', () => {
    const chunks = splitTextIntoChunks('Una factura de luz.', source)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.content).toBe('Una factura de luz.')
    expect(chunks[0]?.index).toBe(0)
  })

  it('conserva documento, sesión y página en cada fragmento', () => {
    const chunks = splitTextIntoChunks('a'.repeat(2000), source)

    expect(chunks.length).toBeGreaterThan(1)

    chunks.forEach((chunk) => {
      expect(chunk.documentId).toBe(source.documentId)
      expect(chunk.sessionId).toBe(source.sessionId)
      expect(chunk.page).toBe(source.page)
    })
  })

  it('numera los fragmentos de forma consecutiva desde cero', () => {
    const chunks = splitTextIntoChunks('a'.repeat(2000), source)

    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2])
  })

  it('acepta exactamente 800 caracteres como un solo fragmento', () => {
    const chunks = splitTextIntoChunks('a'.repeat(MAX_CHUNK_LENGTH), source)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.content).toHaveLength(MAX_CHUNK_LENGTH)
  })

  it('divide 801 caracteres en dos fragmentos con solape de 100', () => {
    const chunks = splitTextIntoChunks('a'.repeat(MAX_CHUNK_LENGTH + 1), source)

    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.content).toHaveLength(MAX_CHUNK_LENGTH)
    expect(chunks[1]?.content).toHaveLength(CHUNK_OVERLAP + 1)
    expect(chunks[1]?.content.slice(0, CHUNK_OVERLAP)).toBe(
      chunks[0]?.content.slice(-CHUNK_OVERLAP)
    )
  })

  it('mantiene el límite de 800 caracteres en textos largos', () => {
    const chunks = splitTextIntoChunks('a'.repeat(2000), source)

    chunks.forEach((chunk) => {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_LENGTH)
    })
  })

  it('aplica 100 caracteres de solape entre fragmentos consecutivos', () => {
    const text = Array.from({ length: 2000 }, (_, index) =>
      String.fromCharCode(97 + (index % 26))
    ).join('')
    const chunks = splitTextIntoChunks(text, source)

    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]
      const current = chunks[index]

      expect(current?.content.slice(0, CHUNK_OVERLAP)).toBe(
        previous?.content.slice(-CHUNK_OVERLAP)
      )
    }
  })

  it('no divide un par sustituto al final de un fragmento', () => {
    const text = `${'a'.repeat(799)}😀${'b'.repeat(100)}`
    const chunks = splitTextIntoChunks(text, source)

    expect(chunks[0]?.content).toBe('a'.repeat(799))
    chunks.forEach((chunk) => {
      expect(hasUnpairedSurrogate(chunk.content)).toBe(false)
    })
  })

  it('no empieza un fragmento en el segundo byte de un par sustituto', () => {
    const text = `${'a'.repeat(699)}😀${'b'.repeat(300)}`
    const chunks = splitTextIntoChunks(text, source)

    chunks.forEach((chunk) => {
      expect(hasUnpairedSurrogate(chunk.content)).toBe(false)
    })
  })

  it('rechaza un documento vacío en los metadatos', () => {
    expect(() =>
      splitTextIntoChunks('texto', { ...source, documentId: '' })
    ).toThrow(InvalidChunkMetadataError)
  })

  it('rechaza una sesión vacía en los metadatos', () => {
    expect(() =>
      splitTextIntoChunks('texto', { ...source, sessionId: '   ' })
    ).toThrow(InvalidChunkMetadataError)
  })

  it('rechaza una página igual a cero', () => {
    expect(() => splitTextIntoChunks('texto', { ...source, page: 0 })).toThrow(
      InvalidChunkMetadataError
    )
  })

  it('rechaza una página negativa', () => {
    expect(() => splitTextIntoChunks('texto', { ...source, page: -1 })).toThrow(
      InvalidChunkMetadataError
    )
  })

  it('rechaza una página no entera', () => {
    expect(() =>
      splitTextIntoChunks('texto', { ...source, page: 1.5 })
    ).toThrow(InvalidChunkMetadataError)
  })
})
