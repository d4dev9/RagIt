import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { Buffer } from 'node:buffer'
import type { PdfFileStore } from '../../ports/pdf-file-store'

const STORAGE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/

export class InvalidStoragePathError extends Error {
  constructor() {
    super('La ruta de almacenamiento del PDF no es válida')
    this.name = 'InvalidStoragePathError'
  }
}

export class PdfNotFoundError extends Error {
  constructor() {
    super('El archivo PDF no existe en el almacenamiento')
    this.name = 'PdfNotFoundError'
  }
}

export class MissingPdfStorageDirError extends Error {
  constructor() {
    super('La variable de entorno PDF_STORAGE_DIR no está definida')
    this.name = 'MissingPdfStorageDirError'
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

export class LocalPdfFileStore implements PdfFileStore {
  private readonly baseDir: string
  private directoryReady: Promise<void> | null = null

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir)
  }

  private ensureDirectory(): Promise<void> {
    this.directoryReady ??= mkdir(this.baseDir, {
      recursive: true,
      mode: 0o700,
    }).then(() => undefined)

    return this.directoryReady
  }

  private resolveStoragePath(storagePath: string): string {
    if (!STORAGE_NAME_PATTERN.test(storagePath)) {
      throw new InvalidStoragePathError()
    }

    const fullPath = resolve(this.baseDir, storagePath)

    if (!fullPath.startsWith(this.baseDir + sep)) {
      throw new InvalidStoragePathError()
    }

    return fullPath
  }

  async save(bytes: Buffer): Promise<string> {
    await this.ensureDirectory()

    const storagePath = `${randomUUID()}.pdf`

    await writeFile(join(this.baseDir, storagePath), bytes, {
      flag: 'wx',
      mode: 0o600,
    })

    return storagePath
  }

  async read(storagePath: string): Promise<Buffer> {
    const fullPath = this.resolveStoragePath(storagePath)

    try {
      return await readFile(fullPath)
    } catch (error) {
      if (isErrnoCode(error, 'ENOENT')) {
        throw new PdfNotFoundError()
      }

      throw error
    }
  }

  async remove(storagePath: string): Promise<void> {
    const fullPath = this.resolveStoragePath(storagePath)

    try {
      await unlink(fullPath)
    } catch (error) {
      if (!isErrnoCode(error, 'ENOENT')) {
        throw error
      }
    }
  }
}

export function createPdfFileStoreFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env
): LocalPdfFileStore {
  const configured = env.PDF_STORAGE_DIR

  if (!configured) {
    throw new MissingPdfStorageDirError()
  }

  return new LocalPdfFileStore(resolve(process.cwd(), configured))
}
