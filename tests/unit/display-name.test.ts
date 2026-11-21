import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DocumentId } from '../../src/domain/documents/document-id'
import { sanitizeDisplayName } from '../../src/domain/documents/display-name'

describe('sanitizeDisplayName (F-02)', () => {
  const documentId = DocumentId.create(randomUUID())

  it('keeps only the final path segment and removes control characters', () => {
    expect(
      sanitizeDisplayName('C:\\private\\..\\report\u0000.pdf', documentId)
    ).toBe('report.pdf')
  })

  it('trims and truncates by Unicode characters', () => {
    expect(sanitizeDisplayName(`  ${'ñ'.repeat(121)}  `, documentId)).toBe(
      'ñ'.repeat(120)
    )
  })

  it('uses the document ID when the sanitized name is empty', () => {
    expect(sanitizeDisplayName('../\\\u0000', documentId)).toBe(
      `documento-${documentId.toString().slice(0, 8)}.pdf`
    )
  })
})
