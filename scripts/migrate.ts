import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { runMigrations } from '../src/infrastructure/database/migrate'

if (existsSync('.env')) {
  loadEnvFile()
}

const connectionString =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('MIGRATION_DATABASE_URL is required')
}

await runMigrations({
  connectionString,
  directory: resolve('migrations'),
})

process.stdout.write('Migrations applied\n')
