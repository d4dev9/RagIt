import { Pool } from 'pg'

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super('La variable de entorno DATABASE_URL no está definida')
    this.name = 'MissingDatabaseUrlError'
  }
}

type PoolGlobal = typeof globalThis & {
  ragitPostgresPool?: Pool
}

export function getPostgresPool(
  env: Readonly<Record<string, string | undefined>> = process.env
): Pool {
  const connectionString = env.DATABASE_URL

  if (!connectionString) {
    throw new MissingDatabaseUrlError()
  }

  const poolGlobal = globalThis as PoolGlobal
  poolGlobal.ragitPostgresPool ??= new Pool({ connectionString, max: 4 })

  return poolGlobal.ragitPostgresPool
}
