import { resolve } from 'node:path'
import { runMigrations } from '../src/infrastructure/database/migrate'

const connectionString = process.env.MIGRATION_DATABASE_URL

if (!connectionString) {
  process.stderr.write('Falta la variable MIGRATION_DATABASE_URL\n')
  process.exit(1)
}

await runMigrations({ connectionString, directory: resolve('migrations') })
process.stdout.write('Migraciones aplicadas\n')
