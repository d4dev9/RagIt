const TEXT_BLOCK_PATTERN = /BT([\s\S]*?)ET/g
const LITERAL_STRING_PATTERN = /\((?:\\[\s\S]|[^()\\])*\)/g
const HEX_STRING_PATTERN = /<([0-9A-Fa-f\s]+)>/g

export interface ExtractedText {
  readonly segments: readonly string[]
}

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

function decodeLiteral(raw: string): string {
  const inner = raw.slice(1, -1)

  return inner.replace(/\\([nrtbf()\\])/g, (_, symbol: string) => {
    return ESCAPES[symbol] ?? symbol
  })
}

function decodeHex(raw: string): string {
  const hex = raw.slice(1, -1).replace(/\s+/g, '')

  if (hex.length === 0 || hex.length % 2 !== 0) {
    return ''
  }

  const bytes = Buffer.from(hex, 'hex')

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

function extractBlockText(block: string): string {
  const literals = block.match(LITERAL_STRING_PATTERN) ?? []
  const hexStrings = block.match(HEX_STRING_PATTERN) ?? []
  const parts = [...literals.map(decodeLiteral), ...hexStrings.map(decodeHex)]

  return parts.join('').trim()
}

export function extractText(pdfBytes: Buffer): ExtractedText {
  const content = pdfBytes.toString('latin1')
  const segments: string[] = []

  for (const match of content.matchAll(TEXT_BLOCK_PATTERN)) {
    const block = match[1] ?? ''
    const text = extractBlockText(block)

    if (text.length > 0) {
      segments.push(text)
    }
  }

  return { segments }
}
