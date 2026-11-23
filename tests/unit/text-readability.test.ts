import { describe, expect, it } from 'vitest'
import {
  MIN_PRINTABLE_CHARACTER_RATIO,
  printableCharacterRatio,
} from '../../src/domain/documents/text-readability'

describe('printableCharacterRatio', () => {
  it('uses the named minimum readable ratio', () => {
    expect(MIN_PRINTABLE_CHARACTER_RATIO).toBe(0.6)
    expect(printableCharacterRatio('área 42, listo.')).toBe(1)
    expect(printableCharacterRatio('ab\u0001\u0002')).toBeLessThan(
      MIN_PRINTABLE_CHARACTER_RATIO
    )
    expect(printableCharacterRatio('')).toBe(0)
  })
})
