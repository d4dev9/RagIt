import { Pool } from 'pg'
import { removeExpiredSessions } from '../src/application/remove-expired-sessions'
import { PostgresChunkRepository } from '../src/infrastructure/database/postgres-chunk-repository'
import { PostgresDocumentRepository } from '../src/infrastructure/database/postgres-document-repository'
import { PostgresJobQueue } from '../src/infrastructure/database/postgres-job-queue'
import { PostgresSessionRepository } from '../src/infrastructure/database/postgres-session-repository'
import { createPdfFileStoreFromEnv } from '../src/infrastructure/storage/pdf-file-store'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  process.stderr.write('Falta la variable DATABASE_URL\n')
  process.exit(1)
}

const pool = new Pool({ connectionString, max: 4 })

try {
  const result = await removeExpiredSessions(new Date(), {
    sessionRepository: new PostgresSessionRepository(pool),
    documentRepository: new PostgresDocumentRepository(pool),
    chunkRepository: new PostgresChunkRepository(pool),
    jobQueue: new PostgresJobQueue(pool),
    pdfFileStore: createPdfFileStoreFromEnv(),
  })

  process.stdout.write(
    `Sesiones eliminadas: ${result.sessionsRemoved}; documentos eliminados: ${result.documentsRemoved}\n`
  )
} catch {
  process.stderr.write('No se pudieron eliminar las sesiones expiradas\n')
  process.exitCode = 1
} finally {
  await pool.end()
}
