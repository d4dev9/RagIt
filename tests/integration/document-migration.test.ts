import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client, Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/infrastructure/database/migrate'
import { integrationEnabled } from './test-database'

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL

interface MigrationSandbox {
  readonly schema: string
  readonly directory: string
  readonly connectionString: string
  readonly adminPool: Pool
  readonly cleanup: () => Promise<void>
}

async function createSandbox(): Promise<MigrationSandbox> {
  if (!migrationUrl) {
    throw new Error('Migration database URL is not configured')
  }

  const schema = `ragit_migration_${randomUUID().replace(/-/g, '')}`
  const directory = await mkdtemp(join(tmpdir(), 'ragit-migration-'))
  const adminPool = new Pool({ connectionString: migrationUrl, max: 1 })
  const url = new URL(migrationUrl)
  url.searchParams.set('options', `-csearch_path=${schema},public`)

  await adminPool.query(`CREATE SCHEMA ${schema}`)

  return {
    schema,
    directory,
    connectionString: url.toString(),
    adminPool,
    cleanup: async () => {
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`)
      await adminPool.end()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

async function prepareMigrationDirectory(
  sandbox: MigrationSandbox,
  files: readonly string[]
): Promise<string> {
  const destination = join(sandbox.directory, randomUUID())
  await mkdir(destination, { recursive: true })

  for (const file of files) {
    await copyFile(resolve('migrations', file), join(destination, file))
  }

  return destination
}

async function seedLegacyDocument(
  connectionString: string
): Promise<{ documentId: string; sessionId: string }> {
  const client = new Client({ connectionString })
  const sessionId = randomUUID()
  const documentId = randomUUID()
  const now = new Date()

  await client.connect()

  try {
    await client.query(
      'INSERT INTO sessions (id, created_at, last_activity_at) VALUES ($1, $2, $3)',
      [sessionId, now, now]
    )
    await client.query(
      `
        INSERT INTO documents (
          id, session_id, status, size_bytes, page_count, created_at, updated_at
        )
        VALUES ($1, $2, 'ready', 100, 1, $3, $3)
      `,
      [documentId, sessionId, now]
    )
    await client.query(
      `
        INSERT INTO jobs (id, type, payload)
        VALUES ($1, 'ingest_document', $2::jsonb)
      `,
      [randomUUID(), JSON.stringify({ documentId, sessionId })]
    )
  } finally {
    await client.end()
  }

  return { documentId, sessionId }
}

describe.skipIf(!integrationEnabled)(
  'migración 007 de metadatos de documentos',
  () => {
    it('aplica en una base limpia', async () => {
      const sandbox = await createSandbox()

      try {
        await runMigrations({
          connectionString: sandbox.connectionString,
          directory: resolve('migrations'),
        })

        const client = new Client({
          connectionString: sandbox.connectionString,
        })
        await client.connect()

        try {
          const columns = await client.query<{
            column_name: string
            is_nullable: string
          }>(
            `
              SELECT column_name, is_nullable
              FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'documents'
            `,
            [sandbox.schema]
          )

          expect(columns.rows.map((row) => row.column_name)).toContain(
            'storage_path'
          )
          expect(columns.rows.map((row) => row.column_name)).toContain(
            'display_name'
          )
          expect(
            columns.rows
              .filter((row) =>
                ['storage_path', 'display_name'].includes(row.column_name)
              )
              .every((row) => row.is_nullable === 'YES')
          ).toBe(true)
        } finally {
          await client.end()
        }
      } finally {
        await sandbox.cleanup()
      }
    })

    it('conserva documentos y trabajos heredados sin metadatos de archivo', async () => {
      const sandbox = await createSandbox()
      const through006 = await prepareMigrationDirectory(sandbox, [
        '001-initial-schema.sql',
        '002-jobs.sql',
        '003-jobs-grants.sql',
        '004-documents-page-count-zero.sql',
        '005-jobs-attempts.sql',
        '006-jobs-delete-grant.sql',
      ])
      const only007 = await prepareMigrationDirectory(sandbox, [
        '007-document-file-metadata.sql',
      ])

      try {
        await runMigrations({
          connectionString: sandbox.connectionString,
          directory: through006,
        })
        const legacy = await seedLegacyDocument(sandbox.connectionString)
        await runMigrations({
          connectionString: sandbox.connectionString,
          directory: only007,
        })

        const client = new Client({
          connectionString: sandbox.connectionString,
        })
        await client.connect()

        try {
          const documentResult = await client.query<{
            id: string
            storage_path: string | null
            display_name: string | null
          }>(
            `
              SELECT id, storage_path, display_name
              FROM documents
              WHERE id = $1 AND session_id = $2
            `,
            [legacy.documentId, legacy.sessionId]
          )
          const jobResult = await client.query<{ count: number }>(
            `
              SELECT COUNT(*)::int AS count
              FROM jobs
              WHERE payload->>'documentId' = $1
                AND payload->>'sessionId' = $2
            `,
            [legacy.documentId, legacy.sessionId]
          )

          expect(documentResult.rows).toEqual([
            {
              id: legacy.documentId,
              storage_path: null,
              display_name: null,
            },
          ])
          expect(jobResult.rows[0]?.count).toBe(1)
        } finally {
          await client.end()
        }
      } finally {
        await sandbox.cleanup()
      }
    })
  }
)
