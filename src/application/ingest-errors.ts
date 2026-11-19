export class InvalidIngestJobPayloadError extends Error {
  constructor() {
    super('El trabajo de ingesta no contiene un payload válido')
    this.name = 'InvalidIngestJobPayloadError'
  }
}

export class IngestDocumentNotFoundError extends Error {
  constructor() {
    super('No se encontró el documento asociado al trabajo de ingesta')
    this.name = 'IngestDocumentNotFoundError'
  }
}
