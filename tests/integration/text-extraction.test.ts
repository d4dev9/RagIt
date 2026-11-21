import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractText } from '../../src/application/extract-text'

interface GroundTruthRow {
  readonly file: string
  readonly page: number
  readonly field: string
  readonly expectedValue: string
}

const FIXTURE_DIRECTORY = resolve('tests/fixtures/ocr')
const SCANNED_FIXTURES = new Set([
  '07_escaneada_limpia.pdf',
  '10_escaneada_mala_calidad.pdf',
])

function readFixture(name: string): Buffer {
  return readFileSync(resolve(FIXTURE_DIRECTORY, name))
}

function readGroundTruth(): readonly GroundTruthRow[] {
  const content = readFileSync(
    resolve(FIXTURE_DIRECTORY, 'ground-truth.csv'),
    'utf8'
  )

  return content
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [file, page, field, expectedValue] = line.split(',')

      return {
        file: file ?? '',
        page: Number(page),
        field: field ?? '',
        expectedValue: expectedValue ?? '',
      }
    })
}

describe('extraccion de texto sobre fixtures (F-03)', () => {
  it('cumple el ground-truth de los PDFs con capa de texto', () => {
    const failures: string[] = []

    for (const row of readGroundTruth()) {
      if (SCANNED_FIXTURES.has(row.file)) {
        continue
      }

      const result = extractText(readFixture(row.file))
      const page = result.pages.find((item) => item.page === row.page)
      const text = page?.segments.join('\n') ?? ''

      if (!text.includes(row.expectedValue)) {
        failures.push(
          `${row.file} pagina ${row.page} campo ${row.field}: falta ${row.expectedValue}`
        )
      }
    }

    expect(failures).toEqual([])
  })

  it.each([...SCANNED_FIXTURES])(
    '%s no tiene capa de texto y falla de forma controlada',
    (file) => {
      const result = extractText(readFixture(file))

      expect(result.segments).toEqual([])
    }
  )

  it('extrae las tres paginas del estado de cuenta con su numero real', () => {
    const result = extractText(readFixture('12_estado_cuenta_largo.pdf'))

    expect(result.pages.map((page) => page.page)).toEqual([1, 2, 3])
    expect(result.pages[0]?.segments.join('\n')).toContain(
      'ESTADO DE CUENTA FICTICIO · página 1 de 3'
    )
    expect(result.pages[1]?.segments.join('\n')).toContain(
      'ESTADO DE CUENTA FICTICIO · página 2 de 3'
    )
    expect(result.pages[2]?.segments.join('\n')).toContain(
      'ESTADO DE CUENTA FICTICIO · página 3 de 3'
    )
  })

  it('extrae texto con caracteres especiales y escapes octales', () => {
    const text = extractText(
      readFixture('06_caracteres_especiales.pdf')
    ).segments.join('\n')

    expect(text).toContain('Editorial Ñandú S.A.')
    expect(text).toContain('año 2026')
  })
})
