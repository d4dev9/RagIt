import {
  DocumentQuotaExceededError,
  InvalidDocumentCountError,
  InvalidPageCountError,
  PageLimitExceededError,
  PdfTooLargeError,
} from './document-errors'

export const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024
export const MAX_DOCUMENT_PAGES = 10
export const MAX_DOCUMENTS_PER_SESSION = 5

export function assertPdfSize(content: Uint8Array): void {
  if (content.byteLength > MAX_PDF_SIZE_BYTES) {
    throw new PdfTooLargeError()
  }
}

export function assertPageLimit(pageCount: number): void {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new InvalidPageCountError()
  }

  if (pageCount > MAX_DOCUMENT_PAGES) {
    throw new PageLimitExceededError()
  }
}

export function assertDocumentQuota(currentDocumentCount: number): void {
  if (!Number.isInteger(currentDocumentCount) || currentDocumentCount < 0) {
    throw new InvalidDocumentCountError()
  }

  if (currentDocumentCount >= MAX_DOCUMENTS_PER_SESSION) {
    throw new DocumentQuotaExceededError()
  }
}
