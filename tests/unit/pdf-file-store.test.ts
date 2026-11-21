import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createPdfFileStoreFromEnv,
  InvalidStoragePathError,
  LocalPdfFileStore,
  MissingPdfStorageDirError,
  PdfNotFoundError,
} from '../../src/infrastructure/storage/pdf-file-store'

const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/

describe('LocalPdfFileStore (F-08)', () => {
  let dir: string
  let store: LocalPdfFileStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ragit-store-'))
    store = new LocalPdfFileStore(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('guarda con un nombre aleatorio que no revela el original', async () => {
    const name = await store.save(Buffer.from('%PDF-1.4 contenido'))

    expect(name).toMatch(STORED_NAME)
    expect(await readdir(dir)).toEqual([name])
  })

  it('devuelve exactamente los bytes guardados', async () => {
    const bytes = Buffer.from('%PDF-1.4 prueba de lectura')
    const name = await store.save(bytes)

    expect((await store.read(name)).equals(bytes)).toBe(true)
  })

  it('no sobrescribe un archivo existente', async () => {
    const first = await store.save(Buffer.from('%PDF-1.4 uno'))
    const second = await store.save(Buffer.from('%PDF-1.4 dos'))

    expect(second).not.toBe(first)
    expect(await readdir(dir)).toHaveLength(2)
  })

  it.each([
    ['ruta relativa con subdirectorio', '../secreto.pdf'],
    ['ruta absoluta', '/etc/passwd.pdf'],
    ['nombre sin formato UUID', 'factura.pdf'],
    ['nombre sin extensión', '01234567-89ab-4cde-8f01-234567890abc'],
  ])('rechaza %s en read y remove', async (_label, path) => {
    await expect(store.read(path)).rejects.toBeInstanceOf(InvalidStoragePathError)
    await expect(store.remove(path)).rejects.toBeInstanceOf(InvalidStoragePathError)
  })

  it('lanza PdfNotFoundError al leer un archivo inexistente', async () => {
    await expect(store.read(`${randomUUID()}.pdf`)).rejects.toBeInstanceOf(PdfNotFoundError)
  })

  it('remove borra el archivo y es idempotente', async () => {
    const name = await store.save(Buffer.from('%PDF-1.4 borrar'))

    await store.remove(name)
    await expect(store.remove(name)).resolves.toBeUndefined()
    expect(await readdir(dir)).toHaveLength(0)
  })

  it.skipIf(process.platform === 'win32')('crea archivos con permisos 0600', async () => {
    const name = await store.save(Buffer.from('%PDF-1.4 permisos'))
    const info = await stat(join(dir, name))

    expect(info.mode & 0o777).toBe(0o600)
  })
})

describe('createPdfFileStoreFromEnv', () => {
  it('exige PDF_STORAGE_DIR', () => {
    expect(() => createPdfFileStoreFromEnv({})).toThrow(MissingPdfStorageDirError)
  })
})
