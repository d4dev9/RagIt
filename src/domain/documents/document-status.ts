import {
  InvalidDocumentStatusError,
  InvalidDocumentTransitionError,
} from './document-errors'

export const DOCUMENT_STATUSES = [
  'pending',
  'processing',
  'ready',
  'failed',
] as const

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export const GENERIC_FAILURE_MESSAGE = 'No se pudo procesar el documento.'

const ALLOWED_TRANSITIONS: Readonly<
  Record<DocumentStatus, readonly DocumentStatus[]>
> = {
  pending: ['processing', 'failed'],
  processing: ['ready', 'failed'],
  ready: [],
  failed: [],
}

export function isDocumentStatus(value: string): value is DocumentStatus {
  return DOCUMENT_STATUSES.some((status) => status === value)
}

export class DocumentState {
  private constructor(private readonly current: DocumentStatus) {}

  static pending(): DocumentState {
    return new DocumentState('pending')
  }

  static from(status: string): DocumentState {
    if (!isDocumentStatus(status)) {
      throw new InvalidDocumentStatusError()
    }

    return new DocumentState(status)
  }

  get status(): DocumentStatus {
    return this.current
  }

  canTransitionTo(next: DocumentStatus): boolean {
    return ALLOWED_TRANSITIONS[this.current].some((status) => status === next)
  }

  transitionTo(next: DocumentStatus): DocumentState {
    if (!this.canTransitionTo(next)) {
      throw new InvalidDocumentTransitionError()
    }

    return new DocumentState(next)
  }

  isTerminal(): boolean {
    return this.current === 'ready' || this.current === 'failed'
  }
}
