import type { DocumentId } from './document-id'

export function sanitizeDisplayName(
  value: string | undefined,
  documentId: DocumentId
): string {
  const fileName = (value ?? '').split(/[\\/]/).pop() ?? ''
  const cleaned = Array.from(fileName.trim())
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return (
        codePoint !== undefined &&
        codePoint > 0x1f &&
        (codePoint < 0x7f || codePoint > 0x9f)
      )
    })
    .slice(0, 120)
    .join('')

  return cleaned || `documento-${documentId.toString().slice(0, 8)}.pdf`
}
