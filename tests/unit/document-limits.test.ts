import { describe, expect, it } from 'vitest'
import {
  DocumentQuotaExceededError,
  InvalidDocumentCountError,
  InvalidPageCountError,
  PageLimitExceededError,
  PdfTooLargeError,
} from '../../src/domain/documents/document-errors'
import {
  MAX_DOCUMENTS_PER_SESSION,
  MAX_DOCUMENT_PAGES,
  MAX_PDF_SIZE_BYTES,
  assertDocumentQuota,
  assertPageLimit,
  assertPdfSize,
} from '../../src/domain/documents/document-limits'

describe('Límites de documento (F-02)', () => {
  it('define un máximo de 5 documentos por sesión', () => {
    expect(MAX_DOCUMENTS_PER_SESSION).toBe(5)
  })

  it('define un máximo de 10 páginas por documento', () => {
    expect(MAX_DOCUMENT_PAGES).toBe(10)
  })

  it('define un máximo de 5 MB por archivo', () => {
    expect(MAX_PDF_SIZE_BYTES).toBe(5 * 1024 * 1024)
  })
})

describe('assertPdfSize', () => {
  it('acepta un archivo por debajo del límite', () => {
    expect(() => assertPdfSize(new Uint8Array(1024))).not.toThrow()
  })

  it('acepta exactamente 5 MB', () => {
    expect(() =>
      assertPdfSize(new Uint8Array(MAX_PDF_SIZE_BYTES))
    ).not.toThrow()
  })

  it('rechaza un archivo de 5 MB + 1 byte', () => {
    expect(() => assertPdfSize(new Uint8Array(MAX_PDF_SIZE_BYTES + 1))).toThrow(
      PdfTooLargeError
    )
  })
})

describe('assertPageLimit', () => {
  it('acepta un documento de una página', () => {
    expect(() => assertPageLimit(1)).not.toThrow()
  })

  it('acepta exactamente 10 páginas', () => {
    expect(() => assertPageLimit(MAX_DOCUMENT_PAGES)).not.toThrow()
  })

  it('rechaza un documento de 11 páginas', () => {
    expect(() => assertPageLimit(MAX_DOCUMENT_PAGES + 1)).toThrow(
      PageLimitExceededError
    )
  })

  it('rechaza un conteo de páginas igual a cero', () => {
    expect(() => assertPageLimit(0)).toThrow(InvalidPageCountError)
  })

  it('rechaza un conteo de páginas negativo', () => {
    expect(() => assertPageLimit(-1)).toThrow(InvalidPageCountError)
  })

  it('rechaza un conteo de páginas no entero', () => {
    expect(() => assertPageLimit(2.5)).toThrow(InvalidPageCountError)
  })
})

describe('assertDocumentQuota', () => {
  it('acepta una sesión sin documentos', () => {
    expect(() => assertDocumentQuota(0)).not.toThrow()
  })

  it('acepta una sesión con cuatro documentos', () => {
    expect(() =>
      assertDocumentQuota(MAX_DOCUMENTS_PER_SESSION - 1)
    ).not.toThrow()
  })

  it('rechaza la sexta subida en la misma sesión (F-02)', () => {
    expect(() => assertDocumentQuota(MAX_DOCUMENTS_PER_SESSION)).toThrow(
      DocumentQuotaExceededError
    )
  })

  it('rechaza una sesión que ya superó el máximo', () => {
    expect(() => assertDocumentQuota(MAX_DOCUMENTS_PER_SESSION + 1)).toThrow(
      DocumentQuotaExceededError
    )
  })

  it('rechaza un conteo de documentos negativo', () => {
    expect(() => assertDocumentQuota(-1)).toThrow(InvalidDocumentCountError)
  })

  it('rechaza un conteo de documentos no entero', () => {
    expect(() => assertDocumentQuota(1.5)).toThrow(InvalidDocumentCountError)
  })
})
