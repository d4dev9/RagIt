import type { Buffer } from 'node:buffer'

export interface PdfFileStore {
  save(bytes: Buffer): Promise<string>
  read(storagePath: string): Promise<Buffer>
  remove(storagePath: string): Promise<void>
}
