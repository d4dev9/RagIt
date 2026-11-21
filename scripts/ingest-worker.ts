import { Pool } from 'pg'
import { processNextJob } from '../src/application/process-job'
import { PostgresChunkRepository } from '../src/infrastructure/database/postgres-chunk-repository'
import { PostgresDocumentRepository } from '../src/infrastructure/database/postgres-document-repository'
import { PostgresJobQueue } from '../src/infrastructure/database/postgres-job-queue'
import { GeminiEmbeddingProvider } from '../src/infrastructure/embeddings/gemini-embedding-provider'
import { createPdfFileStoreFromEnv } from '../src/infrastructure/storage/pdf-file-store'

const IDLE_DELAY_MS = 1000

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  process.stderr.write('Falta la variable DATABASE_URL\n')
  process.exit(1)
}

const pool = new Pool({ connectionString, max: 4 })

const deps = {
  documentRepository: new PostgresDocumentRepository(pool),
  chunkRepository: new PostgresChunkRepository(pool),
  embeddingProvider: new GeminiEmbeddingProvider(),
  pdfFileStore: createPdfFileStoreFromEnv(),
  jobQueue: new PostgresJobQueue(pool),
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function run(): Promise<void> {
  for (;;) {
    let busy: boolean

    try {
      busy = (await processNextJob(deps)) !== null
    } catch {
      process.stderr.write('Error inesperado al procesar un trabajo de ingesta\n')
      busy = true
    }

    if (!busy) {
      await wait(IDLE_DELAY_MS)
    }
  }
}

process.on('SIGTERM', () => {
  void pool.end().then(() => process.exit(0))
})

await run()
