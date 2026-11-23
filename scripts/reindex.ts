import { Pool } from 'pg'
import { reindexEmbeddings } from '../src/application/reindex-embeddings'
import { PostgresChunkRepository } from '../src/infrastructure/database/postgres-chunk-repository'
import { OpenAiCompatibleEmbeddingProvider } from '../src/infrastructure/embeddings/openai-compatible-embedding-provider'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  process.stderr.write('Falta la variable DATABASE_URL\n')
  process.exit(1)
}

const pool = new Pool({ connectionString, max: 4 })

try {
  const updated = await reindexEmbeddings({
    chunkRepository: new PostgresChunkRepository(pool),
    embeddingProvider: new OpenAiCompatibleEmbeddingProvider(),
  })
  process.stdout.write(`Fragmentos reindexados: ${updated}\n`)
} finally {
  await pool.end()
}
