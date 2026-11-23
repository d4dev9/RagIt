import type { IngestionFailureCode } from '../domain/documents/ingestion-failure'

export class InvalidIngestJobPayloadError extends Error {
  constructor(message?: string) {
    super(message || 'El trabajo de ingesta no contiene un payload válido')
    this.name = 'InvalidIngestJobPayloadError'
  }
}

export class IngestionFailureError extends Error {
  constructor(
    readonly code: IngestionFailureCode,
    readonly originalError?: unknown
  ) {
    super(code)
    this.name = 'IngestionFailureError'
  }
}

export class IngestDocumentNotFoundError extends Error {
  constructor() {
    super('No se encontró el documento asociado al trabajo de ingesta')
    this.name = 'IngestDocumentNotFoundError'
  }
}
