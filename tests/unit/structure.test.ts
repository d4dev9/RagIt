import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'

describe('Fase 0: Estructura de carpetas', () => {
  const requiredDirs = [
    'src/domain',
    'src/application',
    'src/ports',
    'src/infrastructure',
    'src/app',
    'src/components',
    'src/lib',
    'tests/unit',
    'tests/integration',
    'tests/e2e',
  ]

  beforeEach(() => {
    // No setup needed - just check directories exist
  })

  requiredDirs.forEach((dir) => {
    it(`debe existir la carpeta ${dir}`, () => {
      const fullPath = join(process.cwd(), dir)
      expect(existsSync(fullPath)).toBe(true)
    })
  })
})