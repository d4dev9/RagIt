import { describe, expect, it } from 'vitest'
import { InvalidPdfSignatureError } from '../../src/domain/documents/document-errors'
import {
  PDF_SIGNATURE_LENGTH,
  assertPdfSignature,
  hasPdfSignature,
} from '../../src/domain/documents/pdf-signature'

function bytesFrom(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('hasPdfSignature', () => {
  it('reconoce la firma de un PDF estándar (F-02)', () => {
    const content = bytesFrom('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj')

    expect(hasPdfSignature(content)).toBe(true)
  })

  it('reconoce la firma mínima %PDF- (F-02)', () => {
    expect(hasPdfSignature(bytesFrom('%PDF-'))).toBe(true)
  })

  it('expone la longitud de la firma esperada', () => {
    expect(PDF_SIGNATURE_LENGTH).toBe(5)
  })

  it('rechaza contenido vacío', () => {
    expect(hasPdfSignature(new Uint8Array(0))).toBe(false)
  })

  it('rechaza contenido más corto que la firma', () => {
    expect(hasPdfSignature(bytesFrom('%PDF'))).toBe(false)
  })

  it('rechaza la firma precedida de espacio en blanco', () => {
    expect(hasPdfSignature(bytesFrom(' %PDF-1.7'))).toBe(false)
  })

  it('rechaza la firma con distinta capitalización', () => {
    expect(hasPdfSignature(bytesFrom('%pdf-1.7'))).toBe(false)
  })

  it('rechaza un archivo con extensión .pdf y contenido de otro tipo (F-02)', () => {
    const contenidoAjeno = bytesFrom(
      'Esto no es un PDF aunque el archivo se llame documento.pdf'
    )

    expect(hasPdfSignature(contenidoAjeno)).toBe(false)
  })

  it('rechaza contenido binario arbitrario sin firma', () => {
    expect(
      hasPdfSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))
    ).toBe(false)
  })
})

describe('assertPdfSignature', () => {
  it('no lanza con un PDF válido (F-02)', () => {
    expect(() => assertPdfSignature(bytesFrom('%PDF-1.4\n'))).not.toThrow()
  })

  it('lanza InvalidPdfSignatureError sin la firma', () => {
    expect(() => assertPdfSignature(bytesFrom('contenido ajeno'))).toThrow(
      InvalidPdfSignatureError
    )
  })

  it('lanza InvalidPdfSignatureError con contenido vacío', () => {
    expect(() => assertPdfSignature(new Uint8Array(0))).toThrow(
      InvalidPdfSignatureError
    )
  })
})
