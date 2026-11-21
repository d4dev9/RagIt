import { inflateSync } from 'node:zlib'

const MAX_DECODED_STREAM_BYTES = 8 * 1024 * 1024

export interface ExtractedPage {
  readonly page: number
  readonly segments: readonly string[]
}

export interface ExtractedText {
  readonly segments: readonly string[]
  readonly pages: readonly ExtractedPage[]
}

interface PdfObject {
  readonly number: number
  readonly generation: number
  readonly dictionary: string
  readonly stream?: Buffer
}

type PdfToken =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name' }
  | { readonly kind: 'operator'; readonly value: string }
  | { readonly kind: 'arrayStart' }
  | { readonly kind: 'arrayEnd' }

const OBJECT_PATTERN = /(\d+)\s+(\d+)\s+obj\b/g
const TYPE_PATTERN = /\/Type\s*\/([A-Za-z0-9]+)/
const PAGES_REFERENCE_PATTERN = /\/Pages\s+(\d+)\s+\d+\s+R/
const CONTENTS_REFERENCE_PATTERN = /\/Contents\s+(\d+)\s+\d+\s+R/
const CONTENTS_ARRAY_PATTERN = /\/Contents\s*\[([^\]]*)\]/
const KIDS_ARRAY_PATTERN = /\/Kids\s*\[([^\]]*)\]/
const REFERENCE_PATTERN = /(\d+)\s+\d+\s+R/g
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/
const WHITESPACE_PATTERN = /\s/
const DELIMITER_PATTERN = /[\s()<>[\]{}/%]/
const LINE_OPERATORS = new Set(['Td', 'TD', 'T*', 'Tm'])

const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  '(': '(',
  ')': ')',
  '\\': '\\',
}

function readLiteralString(
  source: string,
  start: number
): { readonly value: string; readonly next: number } {
  let index = start + 1
  let depth = 1
  let value = ''

  while (index < source.length) {
    const char = source[index] ?? ''

    if (char === '\\') {
      index += 1
      const escaped = source[index]

      if (escaped === undefined) {
        break
      }

      if (escaped === '\r') {
        index += 1

        if (source[index] === '\n') {
          index += 1
        }

        continue
      }

      if (escaped === '\n') {
        index += 1
        continue
      }

      if (escaped >= '0' && escaped <= '7') {
        let octal = ''
        let digits = 0

        while (digits < 3 && index < source.length) {
          const digit = source[index] ?? ''

          if (digit < '0' || digit > '7') {
            break
          }

          octal += digit
          index += 1
          digits += 1
        }

        value += String.fromCharCode(Number.parseInt(octal, 8) & 0xff)
        continue
      }

      value += ESCAPES[escaped] ?? escaped
      index += 1
      continue
    }

    if (char === '(') {
      depth += 1
      value += char
      index += 1
      continue
    }

    if (char === ')') {
      depth -= 1
      index += 1

      if (depth === 0) {
        break
      }

      value += char
      continue
    }

    value += char
    index += 1
  }

  return { value, next: index }
}

function decodeHexBytes(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = bytes.subarray(2)
    const evenLength = body.length - (body.length % 2)
    const swapped = Buffer.from(body.subarray(0, evenLength))

    swapped.swap16()

    return swapped.toString('utf16le')
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le')
  }

  return bytes.toString('latin1')
}

function readHexString(
  source: string,
  start: number
): { readonly value: string; readonly next: number } {
  let index = start + 1
  let hex = ''

  while (index < source.length && source[index] !== '>') {
    const char = source[index] ?? ''

    if (/[0-9A-Fa-f]/.test(char)) {
      hex += char
    }

    index += 1
  }

  if (index < source.length) {
    index += 1
  }

  if (hex.length === 0) {
    return { value: '', next: index }
  }

  if (hex.length % 2 !== 0) {
    hex += '0'
  }

  return {
    value: decodeHexBytes(Buffer.from(hex, 'hex')),
    next: index,
  }
}

function readNameEnd(source: string, start: number): number {
  let index = start + 1

  while (
    index < source.length &&
    !DELIMITER_PATTERN.test(source[index] ?? '')
  ) {
    index += 1
  }

  return index
}

function tokenize(source: string): readonly PdfToken[] {
  const tokens: PdfToken[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index] ?? ''

    if (WHITESPACE_PATTERN.test(char)) {
      index += 1
      continue
    }

    if (char === '%') {
      while (index < source.length && source[index] !== '\n') {
        index += 1
      }

      continue
    }

    if (char === '(') {
      const literal = readLiteralString(source, index)
      tokens.push({ kind: 'string', value: literal.value })
      index = literal.next
      continue
    }

    if (char === '<' && source[index + 1] === '<') {
      index += 2
      continue
    }

    if (char === '<') {
      const hex = readHexString(source, index)
      tokens.push({ kind: 'string', value: hex.value })
      index = hex.next
      continue
    }

    if (char === '>') {
      index += 1
      continue
    }

    if (char === '[') {
      tokens.push({ kind: 'arrayStart' })
      index += 1
      continue
    }

    if (char === ']') {
      tokens.push({ kind: 'arrayEnd' })
      index += 1
      continue
    }

    if (char === '/') {
      const next = readNameEnd(source, index)
      tokens.push({ kind: 'name' })
      index = next
      continue
    }

    if (char === '{' || char === '}') {
      index += 1
      continue
    }

    let end = index

    while (
      end < source.length &&
      !WHITESPACE_PATTERN.test(source[end] ?? '') &&
      !DELIMITER_PATTERN.test(source[end] ?? '')
    ) {
      end += 1
    }

    if (end === index) {
      index += 1
      continue
    }

    const value = source.slice(index, end)

    if (NUMBER_PATTERN.test(value)) {
      tokens.push({ kind: 'number', value: Number(value) })
    } else {
      tokens.push({ kind: 'operator', value })
    }

    index = end
  }

  return tokens
}

function showOperand(tokens: readonly PdfToken[]): string {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]

    if (token?.kind === 'string') {
      return token.value
    }
  }

  return ''
}

function showArrayOperand(tokens: readonly PdfToken[]): string {
  let value = ''

  for (const token of tokens) {
    if (token.kind === 'string') {
      value += token.value
      continue
    }

    if (
      token.kind === 'number' &&
      token.value <= -120 &&
      value.length > 0 &&
      !value.endsWith(' ')
    ) {
      value += ' '
    }
  }

  return value
}

function flushText(current: string, segments: string[]): void {
  for (const line of current.split('\n')) {
    const text = line.trim()

    if (text.length > 0) {
      segments.push(text)
    }
  }
}

function extractContentText(content: string): readonly string[] {
  const tokens = tokenize(content)
  const segments: string[] = []
  let pending: PdfToken[] = []
  let current = ''
  let inTextObject = false

  function breakLine(): void {
    if (current.length > 0 && !current.endsWith('\n')) {
      current += '\n'
    }
  }

  for (const token of tokens) {
    if (token.kind !== 'operator') {
      if (inTextObject) {
        pending.push(token)
      }

      continue
    }

    if (token.value === 'BT') {
      inTextObject = true
      current = ''
      pending = []
      continue
    }

    if (token.value === 'ET') {
      if (inTextObject) {
        flushText(current, segments)
      }

      inTextObject = false
      current = ''
      pending = []
      continue
    }

    if (!inTextObject) {
      pending = []
      continue
    }

    if (token.value === 'Tj') {
      current += showOperand(pending)
    } else if (token.value === 'TJ') {
      current += showArrayOperand(pending)
    } else if (token.value === "'") {
      breakLine()
      current += showOperand(pending)
    } else if (token.value === '"') {
      breakLine()
      current += showOperand(pending)
    } else if (LINE_OPERATORS.has(token.value)) {
      breakLine()
    }

    pending = []
  }

  return segments
}

function ascii85Decode(encoded: string): Buffer | null {
  const text = encoded
    .replace(/^\s*<~/, '')
    .replace(/~>[\s\S]*$/, '')
    .replace(/\s+/g, '')
  const bytes: number[] = []
  let group: number[] = []

  for (const char of text) {
    if (char === 'z' && group.length === 0) {
      bytes.push(0, 0, 0, 0)
      continue
    }

    const code = char.charCodeAt(0) - 33

    if (code < 0 || code > 84) {
      return null
    }

    group.push(code)

    if (group.length === 5) {
      let value = 0

      for (const digit of group) {
        value = value * 85 + digit
      }

      bytes.push(
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff
      )
      group = []
    }
  }

  if (group.length === 1) {
    return null
  }

  if (group.length > 1) {
    const originalLength = group.length

    while (group.length < 5) {
      group.push(84)
    }

    let value = 0

    for (const digit of group) {
      value = value * 85 + digit
    }

    const tail = [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]

    bytes.push(...tail.slice(0, originalLength - 1))
  }

  return Buffer.from(bytes)
}

function readFilters(dictionary: string): readonly string[] {
  const arrayMatch = /\/Filter\s*\[([^\]]*)\]/.exec(dictionary)

  if (arrayMatch) {
    return [...(arrayMatch[1] ?? '').matchAll(/\/([A-Za-z0-9]+)/g)].map(
      (match) => match[1] ?? ''
    )
  }

  const singleMatch = /\/Filter\s*\/([A-Za-z0-9]+)/.exec(dictionary)

  return singleMatch?.[1] ? [singleMatch[1]] : []
}

function decodeStream(stream: Buffer, dictionary: string): Buffer | null {
  const filters = readFilters(dictionary)
  let decoded = stream

  for (const filter of filters) {
    if (filter === 'ASCII85Decode' || filter === 'ASCII85') {
      const text = ascii85Decode(decoded.toString('latin1'))

      if (!text) {
        return null
      }

      decoded = text
      continue
    }

    if (filter === 'FlateDecode' || filter === 'Fl') {
      try {
        decoded = inflateSync(decoded, { maxOutputLength: MAX_DECODED_STREAM_BYTES })
      } catch {
        return null
      }

      continue
    }

    return null
  }

  return decoded
}

function parseObjects(bytes: Buffer): readonly PdfObject[] {
  const raw = bytes.toString('latin1')
  const objects: PdfObject[] = []
  OBJECT_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null = OBJECT_PATTERN.exec(raw)

  while (match) {
    const headerEnd = OBJECT_PATTERN.lastIndex
    const endObject = raw.indexOf('endobj', headerEnd)
    const streamIndex = raw.indexOf('stream', headerEnd)

    if (streamIndex === -1 || (endObject !== -1 && endObject < streamIndex)) {
      objects.push({
        number: Number(match[1]),
        generation: Number(match[2]),
        dictionary: raw.slice(
          headerEnd,
          endObject === -1 ? raw.length : endObject
        ),
      })

      if (endObject !== -1) {
        OBJECT_PATTERN.lastIndex = endObject + 6
      }

      match = OBJECT_PATTERN.exec(raw)
      continue
    }

    const dictionary = raw.slice(headerEnd, streamIndex)
    const lengthMatch = /\/Length\s+(\d+)/.exec(dictionary)
    let dataStart = streamIndex + 6

    if (raw[dataStart] === '\r') {
      dataStart += 1
    }

    if (raw[dataStart] === '\n') {
      dataStart += 1
    }

    let dataEnd = raw.length

    if (lengthMatch?.[1]) {
      dataEnd = dataStart + Number(lengthMatch[1])
    } else {
      const endStream = raw.indexOf('endstream', dataStart)

      if (endStream !== -1) {
        dataEnd = endStream
      }
    }

    const safeEnd = Math.min(Math.max(dataEnd, dataStart), bytes.length)

    objects.push({
      number: Number(match[1]),
      generation: Number(match[2]),
      dictionary,
      stream: bytes.subarray(dataStart, safeEnd),
    })

    const endStream = raw.indexOf('endstream', safeEnd)
    const afterStream = endStream === -1 ? -1 : raw.indexOf('endobj', endStream)

    if (afterStream !== -1) {
      OBJECT_PATTERN.lastIndex = afterStream + 6
    } else {
      OBJECT_PATTERN.lastIndex = safeEnd
    }

    match = OBJECT_PATTERN.exec(raw)
  }

  return objects
}

function readType(dictionary: string): string | null {
  return TYPE_PATTERN.exec(dictionary)?.[1] ?? null
}

function readReferences(source: string): readonly number[] {
  return [...source.matchAll(REFERENCE_PATTERN)].map((match) =>
    Number(match[1])
  )
}

function readPageContents(dictionary: string): readonly number[] {
  const arrayMatch = CONTENTS_ARRAY_PATTERN.exec(dictionary)

  if (arrayMatch) {
    return readReferences(arrayMatch[1] ?? '')
  }

  const singleMatch = CONTENTS_REFERENCE_PATTERN.exec(dictionary)

  return singleMatch?.[1] ? [Number(singleMatch[1])] : []
}

function resolvePageContents(
  objects: readonly PdfObject[]
): readonly (readonly number[])[] {
  const byNumber = new Map<number, PdfObject>()

  for (const object of objects) {
    byNumber.set(object.number, object)
  }

  const allObjects = [...byNumber.values()]
  const catalog = allObjects.find(
    (object) => readType(object.dictionary) === 'Catalog'
  )
  const catalogPages = catalog
    ? PAGES_REFERENCE_PATTERN.exec(catalog.dictionary)?.[1]
    : undefined
  const rootObject =
    (catalogPages ? byNumber.get(Number(catalogPages)) : undefined) ??
    allObjects.find((object) => readType(object.dictionary) === 'Pages')

  if (!rootObject) {
    return []
  }

  const visited = new Set<number>()
  const pages: (readonly number[])[] = []

  const walk = (reference: number): void => {
    if (visited.has(reference)) {
      return
    }

    visited.add(reference)

    const object = byNumber.get(reference)

    if (!object) {
      return
    }

    const type = readType(object.dictionary)
    const kidsMatch = KIDS_ARRAY_PATTERN.exec(object.dictionary)

    if (type === 'Pages' || (type === null && kidsMatch)) {
      for (const kid of readReferences(kidsMatch?.[1] ?? '')) {
        walk(kid)
      }

      return
    }

    if (
      type === 'Page' ||
      (type === null && CONTENTS_REFERENCE_PATTERN.test(object.dictionary)) ||
      CONTENTS_ARRAY_PATTERN.test(object.dictionary)
    ) {
      pages.push(readPageContents(object.dictionary))
    }
  }

  walk(rootObject.number)

  return pages
}

function extractReferencesText(
  byNumber: ReadonlyMap<number, PdfObject>,
  references: readonly number[]
): readonly string[] {
  const segments: string[] = []
  const visited = new Set<number>()

  for (const reference of references) {
    if (visited.has(reference)) {
      continue
    }

    visited.add(reference)

    const object = byNumber.get(reference)

    if (!object?.stream) {
      continue
    }

    const decoded = decodeStream(object.stream, object.dictionary)

    if (!decoded) {
      continue
    }

    segments.push(...extractContentText(decoded.toString('latin1')))
  }

  return segments
}

export function extractText(pdfBytes: Buffer): ExtractedText {
  try {
    const objects = parseObjects(pdfBytes)
    const byNumber = new Map<number, PdfObject>()

    for (const object of objects) {
      byNumber.set(object.number, object)
    }

    const pageContents = resolvePageContents(objects)
    const pages: ExtractedPage[] = []

    if (pageContents.length > 0) {
      pageContents.forEach((references, index) => {
        pages.push({
          page: index + 1,
          segments: extractReferencesText(byNumber, references),
        })
      })
    } else {
      for (const object of byNumber.values()) {
        if (!object.stream) {
          continue
        }

        const decoded = decodeStream(object.stream, object.dictionary)

        if (!decoded) {
          continue
        }

        const segments = extractContentText(decoded.toString('latin1'))

        if (segments.length > 0) {
          pages.push({ page: pages.length + 1, segments })
        }
      }
    }

    return {
      segments: pages.flatMap((page) => page.segments),
      pages,
    }
  } catch {
    return { segments: [], pages: [] }
  }
}
