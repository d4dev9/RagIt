export const MIN_PRINTABLE_CHARACTER_RATIO = 0.6

const PRINTABLE_CHARACTER = /[\p{L}\p{N}\s.,!?;:'"()-]/u

export function printableCharacterRatio(text: string): number {
  const characters = Array.from(text)

  if (characters.length === 0) {
    return 0
  }

  const printableCount = characters.filter((character) =>
    PRINTABLE_CHARACTER.test(character)
  ).length

  return printableCount / characters.length
}
