export class InvalidPdfSignatureError extends Error {
  constructor() {
    super('Invalid PDF signature')
    this.name = 'InvalidPdfSignatureError'
  }
}

export class PdfTooLargeError extends Error {
  constructor() {
    super('PDF exceeds the maximum allowed size')
    this.name = 'PdfTooLargeError'
  }
}

export class PageLimitExceededError extends Error {
  constructor() {
    super('PDF exceeds the maximum allowed page count')
    this.name = 'PageLimitExceededError'
  }
}

export class DocumentQuotaExceededError extends Error {
  constructor() {
    super('Session reached the maximum number of documents')
    this.name = 'DocumentQuotaExceededError'
  }
}

export class InvalidPageCountError extends Error {
  constructor() {
    super('Page count must be a positive integer')
    this.name = 'InvalidPageCountError'
  }
}

export class InvalidDocumentCountError extends Error {
  constructor() {
    super('Document count must be a non-negative integer')
    this.name = 'InvalidDocumentCountError'
  }
}

export class InvalidChunkMetadataError extends Error {
  constructor() {
    super('Chunk metadata requires a document, a session and a positive page')
    this.name = 'InvalidChunkMetadataError'
  }
}

export class InvalidDocumentStatusError extends Error {
  constructor() {
    super('Unknown document status')
    this.name = 'InvalidDocumentStatusError'
  }
}

export class InvalidDocumentTransitionError extends Error {
  constructor() {
    super('Invalid document status transition')
    this.name = 'InvalidDocumentTransitionError'
  }
}
