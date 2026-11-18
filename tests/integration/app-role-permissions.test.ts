import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAppPool,
  integrationEnabled,
  migrateDatabase,
} from './test-database'

const INSUFFICIENT_PRIVILEGE = '42501'

describe.skipIf(!integrationEnabled)(
  'Permisos del usuario de aplicación',
  () => {
    let pool: Pool

    beforeAll(async () => {
      await migrateDatabase()
      pool = createAppPool()
    })

    afterAll(async () => {
      await pool.end()
    })

    it('no es superusuario ni puede crear bases o roles', async () => {
      const result = await pool.query<{
        rolsuper: boolean
        rolcreatedb: boolean
        rolcreaterole: boolean
      }>(
        `
        SELECT rolsuper, rolcreatedb, rolcreaterole
        FROM pg_roles
        WHERE rolname = current_user
      `
      )

      expect(result.rows[0]).toEqual({
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
      })
    })

    it('puede leer y escribir las tablas de la aplicación', async () => {
      const result = await pool.query<{
        can_select: boolean
        can_insert: boolean
        can_update: boolean
        can_delete: boolean
      }>(
        `
        SELECT
          has_table_privilege(current_user, 'sessions', 'SELECT') AS can_select,
          has_table_privilege(current_user, 'sessions', 'INSERT') AS can_insert,
          has_table_privilege(current_user, 'sessions', 'UPDATE') AS can_update,
          has_table_privilege(current_user, 'sessions', 'DELETE') AS can_delete
      `
      )

      expect(result.rows[0]).toEqual({
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: true,
      })
    })

    it('no puede crear esquemas ni tablas', async () => {
      await expect(
        pool.query('CREATE SCHEMA intento_de_escalada')
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
      await expect(
        pool.query('CREATE TABLE intento_de_tabla (id integer)')
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })

    it('no puede crear tablas temporales', async () => {
      await expect(
        pool.query('CREATE TEMP TABLE intento_temporal (id integer)')
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })

    it('no puede borrar ni truncar tablas de la aplicación', async () => {
      await expect(pool.query('DROP TABLE sessions')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      })
      await expect(pool.query('TRUNCATE sessions')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      })
    })

    it('no puede crear roles', async () => {
      await expect(
        pool.query('CREATE ROLE intento_de_rol')
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })
  }
)
