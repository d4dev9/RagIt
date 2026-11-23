import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractText } from '../../src/application/extract-text'

function ascii85Encode(data: Buffer): string {
  let output = ''

  for (let offset = 0; offset < data.length; offset += 4) {
    const chunk = data.subarray(offset, offset + 4)
    const padding = 4 - chunk.length
    const padded = Buffer.concat([chunk, Buffer.alloc(padding)])
    let value = padded.readUInt32BE(0)

    if (value === 0 && padding === 0) {
      output += 'z'
      continue
    }

    const digits: string[] = []

    for (let index = 0; index < 5; index += 1) {
      digits.unshift(String.fromCharCode((value % 85) + 33))
      value = Math.floor(value / 85)
    }

    output += digits.slice(0, 5 - padding).join('')
  }

  return `${output}~>`
}

function buildPdf(
  pages: readonly string[],
  filter: 'none' | 'flate' | 'ascii85' = 'none'
): Buffer {
  const chunks: Buffer[] = []
  const pageIds = pages.map((_, index) => 3 + index)
  const contentIds = pages.map((_, index) => 3 + pages.length + index)

  const append = (value: string): void => {
    chunks.push(Buffer.from(value, 'latin1'))
  }

  append('%PDF-1.4\n')
  append('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  append(
    `2 0 obj\n<< /Type /Pages /Kids [${pageIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] /Count ${pages.length} >>\nendobj\n`
  )

  pages.forEach((_, index) => {
    append(
      `${pageIds[index]} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${
        contentIds[index]
      } 0 R >>\nendobj\n`
    )
  })

  pages.forEach((content, index) => {
    const raw = Buffer.from(`BT\n${content}\nET`, 'latin1')
    let data = raw
    let filterEntry = ''

    if (filter === 'flate') {
      data = deflateSync(raw)
      filterEntry = ' /Filter /FlateDecode'
    }

    if (filter === 'ascii85') {
      data = Buffer.from(ascii85Encode(deflateSync(raw)), 'latin1')
      filterEntry = ' /Filter [/ASCII85Decode /FlateDecode]'
    }

    append(
      `${contentIds[index]} 0 obj\n<< /Length ${data.length}${filterEntry} >>\nstream\n`
    )
    chunks.push(data)
    append('\nendstream\nendobj\n')
  })

  append('%%EOF')

  return Buffer.concat(chunks)
}

function buildNestedPdf(): Buffer {
  const chunks: Buffer[] = []
  const append = (value: string): void => {
    chunks.push(Buffer.from(value, 'latin1'))
  }
  const content = (text: string): Buffer =>
    Buffer.from(`BT\n(${text}) Tj\nET\n`, 'latin1')

  append('%PDF-1.4\n')
  append('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  append('2 0 obj\n<< /Type /Pages /Kids [7 0 R 5 0 R] /Count 3 >>\nendobj\n')
  append('3 0 obj\n<< /Type /Page /Parent 7 0 R /Contents 8 0 R >>\nendobj\n')
  append(
    '4 0 obj\n<< /Type /Page /Parent 7 0 R /Contents [9 0 R 10 0 R] >>\nendobj\n'
  )
  append('5 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 11 0 R >>\nendobj\n')
  append(
    '7 0 obj\n<< /Type /Pages /Parent 2 0 R /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n'
  )

  const streams: readonly (readonly [number, string])[] = [
    [8, 'pagina uno'],
    [9, 'pagina dos parte A'],
    [10, 'pagina dos parte B'],
    [11, 'pagina tres'],
  ]

  for (const [number, text] of streams) {
    const stream = content(text)
    append(`${number} 0 obj\n<< /Length ${stream.length} >>\nstream\n`)
    chunks.push(stream)
    append('\nendstream\nendobj\n')
  }

  append('%%EOF')

  return Buffer.concat(chunks)
}

describe('extractText (F-03)', () => {
  it('extrae texto de streams sin filtro', () => {
    const result = extractText(buildPdf(['(hola mundo) Tj']))

    expect(result.segments).toEqual(['hola mundo'])
  })

  it('elimina y cuenta caracteres nulos del texto extraído', () => {
    const result = extractText(
      buildPdf(['(comprobante\\000 legible) Tj'])
    )

    expect(result.segments).toEqual(['comprobante legible'])
    expect(result.nulCharactersRemoved).toBe(1)
  })

  it('extrae texto de streams con FlateDecode', () => {
    const result = extractText(buildPdf(['(contenido comprimido) Tj'], 'flate'))

    expect(result.segments).toEqual(['contenido comprimido'])
  })

  it('extrae texto de streams con ASCII85Decode y FlateDecode', () => {
    const result = extractText(buildPdf(['(cadena codificada) Tj'], 'ascii85'))

    expect(result.segments).toEqual(['cadena codificada'])
  })

  it('soporta Tj, TJ, comilla simple y comilla doble', () => {
    const result = extractText(
      buildPdf([
        [
          '(linea uno) Tj T*',
          '[(linea) -200 (dos)] TJ T*',
          '(linea tres) Tj T*',
          "(linea cuatro) '",
          '1 2 (linea cinco) "',
        ].join('\n'),
      ])
    )

    expect(result.segments).toEqual([
      'linea uno',
      'linea dos',
      'linea tres',
      'linea cuatro',
      'linea cinco',
    ])
  })

  it('decodifica escapes octales y parentesis anidados', () => {
    const result = extractText(
      buildPdf(['(caf\\351 y \\321and\\372 \\(grupo\\) \\(anidado\\)) Tj'])
    )

    expect(result.segments).toEqual(['café y Ñandú (grupo) (anidado)'])
  })

  it('decodifica cadenas hexadecimales UTF-16BE y UTF-16LE', () => {
    const result = extractText(
      buildPdf(['<FEFF00480065006C006C006F> Tj <FFFE480065006C006C006F00> Tj'])
    )

    expect(result.segments).toEqual(['HelloHello'])
  })

  it('recorre un arbol de paginas anidado y Contents en arreglo', () => {
    const result = extractText(buildNestedPdf())

    expect(result.pages).toEqual([
      { page: 1, segments: ['pagina uno'] },
      { page: 2, segments: ['pagina dos parte A', 'pagina dos parte B'] },
      { page: 3, segments: ['pagina tres'] },
    ])
  })

  it('extrae texto de varias paginas', () => {
    const result = extractText(
      buildPdf(['(pagina uno) Tj', '(pagina dos) Tj', '(pagina tres) Tj'])
    )

    expect(result.segments).toEqual(['pagina uno', 'pagina dos', 'pagina tres'])
    expect(result.pages).toEqual([
      { page: 1, segments: ['pagina uno'] },
      { page: 2, segments: ['pagina dos'] },
      { page: 3, segments: ['pagina tres'] },
    ])
  })

  it('no cierra el bloque de texto si el contenido contiene ET', () => {
    const result = extractText(buildPdf(['(texto con ET falso) Tj']))

    expect(result.segments).toEqual(['texto con ET falso'])
  })

  it('descarta streams que descomprimen por encima del limite de salida', () => {
    const oversized = `(${'x'.repeat(9 * 1024 * 1024)}) Tj`
    const pdf = buildPdf([oversized], 'flate')

    const result = extractText(pdf)

    expect(result.segments).toEqual([])
  })

  it('devuelve una lista vacia si no hay texto extraible', () => {
    const result = extractText(buildPdf(['0 0 m 100 100 l S']))

    expect(result.segments).toEqual([])
  })

  it('devuelve una lista vacia ante un PDF invalido o un filtro desconocido', () => {
    expect(extractText(Buffer.from('esto no es un PDF')).segments).toEqual([])

    const invalid = Buffer.concat([
      Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Length 4 /Filter /DCTDecode >>\nstream\n',
        'latin1'
      ),
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ])

    expect(extractText(invalid).segments).toEqual([])

    const invalidFlate = Buffer.concat([
      Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Length 7 /Filter /FlateDecode >>\nstream\n',
        'latin1'
      ),
      Buffer.from('basura!', 'latin1'),
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ])

    expect(extractText(invalidFlate).segments).toEqual([])
  })
})
