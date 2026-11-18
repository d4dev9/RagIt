import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'

const MIGRATION_LOCK_ID = 827204

export interface MigrationOptions {
  readonly connectionString: string
  readonly directory: string
}

export async function runMigrations(options: MigrationOptions): Promise<void> {
  const client = new Client({ connectionString: options.connectionString })

  await client.connect()

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const appliedResult = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations'
    )
    const applied = new Set(appliedResult.rows.map((row) => row.version))
    const files = (await readdir(options.directory))
      .filter((file) => file.endsWith('.sql'))
      .sort()

    for (const file of files) {
      if (applied.has(file)) {
        continue
      }

      const sql = await readFile(join(options.directory, file), 'utf8')

      await client.query('BEGIN')

      try {
        await client.query(sql)
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [file]
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID])
      .catch(() => undefined)
    await client.end()
  }
}
