import { describe, expect, it } from 'vitest'
import {
  INGESTION_FAILURE_CODES,
  INGESTION_FAILURE_MESSAGES,
  ingestionFailureMessage,
} from '../../src/domain/documents/ingestion-failure'

describe('ingestion failure messages', () => {
  it('defines a Spanish message for every stable failure code', () => {
    expect(Object.keys(INGESTION_FAILURE_MESSAGES).sort()).toEqual(
      [...INGESTION_FAILURE_CODES].sort()
    )
    expect(
      ingestionFailureMessage('NO_EXTRACTABLE_TEXT')
    ).toBe(
      'No pudimos leer texto de este PDF. Puede ser un escaneo, que aún no soportamos.'
    )
    expect(ingestionFailureMessage('UNKNOWN')).toBe(
      'No pudimos procesar el documento. Inténtalo de nuevo más tarde.'
    )
  })
})
