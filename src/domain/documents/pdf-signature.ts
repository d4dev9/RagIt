import { InvalidPdfSignatureError } from './document-errors'

const PDF_SIGNATURE_BYTES: readonly number[] = [0x25, 0x50, 0x44, 0x46, 0x2d]

export const PDF_SIGNATURE_LENGTH = PDF_SIGNATURE_BYTES.length

export function hasPdfSignature(content: Uint8Array): boolean {
  if (content.length < PDF_SIGNATURE_LENGTH) {
    return false
  }

  return PDF_SIGNATURE_BYTES.every(
    (signatureByte, index) => content[index] === signatureByte
  )
}

export function assertPdfSignature(content: Uint8Array): void {
  if (!hasPdfSignature(content)) {
    throw new InvalidPdfSignatureError()
  }
}
