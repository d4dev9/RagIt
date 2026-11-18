import { InvalidDocumentIdError } from './document-errors'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class DocumentId {
  private constructor(private readonly value: string) {}

  static create(value: string): DocumentId {
    if (!UUID_V4_PATTERN.test(value)) {
      throw new InvalidDocumentIdError()
    }

    return new DocumentId(value.toLowerCase())
  }

  toString(): string {
    return this.value
  }

  equals(other: DocumentId): boolean {
    return this.value === other.value
  }
}
