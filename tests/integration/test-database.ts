import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { ChunkId } from '../../src/domain/documents/chunk-id'
import { DocumentId } from '../../src/domain/documents/document-id'
import type { DocumentStatus } from '../../src/domain/documents/document-status'
import { EMBEDDING_DIMENSIONS } from '../../src/domain/documents/embedding'
import { Session } from '../../src/domain/sessions/session'
import { SessionId } from '../../src/domain/sessions/session-id'
import { runMigrations } from '../../src/infrastructure/database/migrate'
import type { DocumentRecord } from '../../src/ports/documents/document-repository'
import type { ChunkInput } from '../../src/ports/documents/chunk-repository'

const APP_DATABASE_URL = process.env.TEST_DATABASE_URL
const MIGRATION_DATABASE_URL = process.env.TEST_MIGRATION_DATABASE_URL

export const integrationEnabled = Boolean(
  APP_DATABASE_URL && MIGRATION_DATABASE_URL
)

function requireUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('Integration database URL is not configured')
  }

  return value
}

export function createAppPool(): Pool {
  return new Pool({ connectionString: requireUrl(APP_DATABASE_URL), max: 2 })
}

export function createAdminPool(): Pool {
  return new Pool({
    connectionString: requireUrl(MIGRATION_DATABASE_URL),
    max: 2,
  })
}

export async function migrateDatabase(): Promise<void> {
  await runMigrations({
    connectionString: requireUrl(MIGRATION_DATABASE_URL),
    directory: resolve('migrations'),
  })
}

export function createSession(now: Date = new Date()): Session {
  return Session.create(SessionId.create(randomUUID()), now)
}

export interface DocumentOverrides {
  readonly status?: DocumentStatus
  readonly storagePath?: string | null
  readonly displayName?: string
  readonly sizeBytes?: number
  readonly pageCount?: number
  readonly createdAt?: Date
  readonly updatedAt?: Date
}

export function createDocumentRecord(
  overrides: DocumentOverrides = {}
): DocumentRecord {
  const now = new Date()
  const id = DocumentId.create(randomUUID())

  return {
    id,
    status: overrides.status ?? 'pending',
    storagePath:
      overrides.storagePath === undefined
        ? `${randomUUID()}.pdf`
        : overrides.storagePath,
    displayName: overrides.displayName ?? 'documento.pdf',
    sizeBytes: overrides.sizeBytes ?? 1024,
    pageCount: overrides.pageCount ?? 1,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? now,
  }
}

export function createEmbedding(fill: number): readonly number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill)
}

export function createChunkInput(
  index: number,
  content: string,
  embedding: readonly number[],
  page = 1
): ChunkInput {
  return {
    id: ChunkId.create(randomUUID()),
    page,
    index,
    content,
    embedding,
  }
}
