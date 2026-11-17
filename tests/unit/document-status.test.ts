import { describe, expect, it } from 'vitest'
import {
  InvalidDocumentStatusError,
  InvalidDocumentTransitionError,
} from '../../src/domain/documents/document-errors'
import {
  DOCUMENT_STATUSES,
  DocumentState,
  GENERIC_FAILURE_MESSAGE,
  isDocumentStatus,
} from '../../src/domain/documents/document-status'

describe('Estados de documento (F-05)', () => {
  it('define exactamente pending, processing, ready y failed', () => {
    expect(DOCUMENT_STATUSES).toEqual([
      'pending',
      'processing',
      'ready',
      'failed',
    ])
  })

  it('inicia en pending', () => {
    expect(DocumentState.pending().status).toBe('pending')
  })

  it('reconstruye cada estado válido', () => {
    DOCUMENT_STATUSES.forEach((status) => {
      expect(DocumentState.from(status).status).toBe(status)
    })
  })

  it('rechaza un estado desconocido', () => {
    expect(() => DocumentState.from('deleted')).toThrow(
      InvalidDocumentStatusError
    )
  })

  it('reconoce los estados válidos', () => {
    expect(isDocumentStatus('ready')).toBe(true)
    expect(isDocumentStatus('deleted')).toBe(false)
  })

  it('permite pending a processing', () => {
    expect(DocumentState.pending().canTransitionTo('processing')).toBe(true)
  })

  it('permite pending a failed', () => {
    expect(DocumentState.pending().canTransitionTo('failed')).toBe(true)
  })

  it('permite processing a ready', () => {
    expect(DocumentState.from('processing').canTransitionTo('ready')).toBe(true)
  })

  it('permite processing a failed', () => {
    expect(DocumentState.from('processing').canTransitionTo('failed')).toBe(
      true
    )
  })

  it('rechaza pending a ready sin pasar por processing', () => {
    expect(DocumentState.pending().canTransitionTo('ready')).toBe(false)
  })

  it('rechaza cualquier salida desde ready', () => {
    const ready = DocumentState.from('ready')

    DOCUMENT_STATUSES.forEach((status) => {
      expect(ready.canTransitionTo(status)).toBe(false)
    })
  })

  it('rechaza cualquier salida desde failed', () => {
    const failed = DocumentState.from('failed')

    DOCUMENT_STATUSES.forEach((status) => {
      expect(failed.canTransitionTo(status)).toBe(false)
    })
  })

  it('devuelve un estado nuevo sin mutar el anterior', () => {
    const pending = DocumentState.pending()
    const processing = pending.transitionTo('processing')

    expect(pending.status).toBe('pending')
    expect(processing.status).toBe('processing')
  })

  it('permite la cadena pending, processing y ready', () => {
    const ready = DocumentState.pending()
      .transitionTo('processing')
      .transitionTo('ready')

    expect(ready.status).toBe('ready')
  })

  it('lanza InvalidDocumentTransitionError en una transición prohibida', () => {
    expect(() => DocumentState.pending().transitionTo('ready')).toThrow(
      InvalidDocumentTransitionError
    )
  })

  it('marca ready y failed como estados terminales', () => {
    expect(DocumentState.from('ready').isTerminal()).toBe(true)
    expect(DocumentState.from('failed').isTerminal()).toBe(true)
    expect(DocumentState.from('pending').isTerminal()).toBe(false)
    expect(DocumentState.from('processing').isTerminal()).toBe(false)
  })

  it('expone un motivo genérico para el usuario', () => {
    expect(GENERIC_FAILURE_MESSAGE).toBe('No se pudo procesar el documento.')
  })
})
