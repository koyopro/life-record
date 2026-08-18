import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless'
import {
  drizzle as drizzlePg,
  type NodePgDatabase,
} from 'drizzle-orm/node-postgres'
import { Pool as NeonPool } from '@neondatabase/serverless'
import { Pool as PgPool } from 'pg'
import * as schema from './schema'

/**
 * 環境によってドライバを使い分ける（docs/04-architecture.md 4.4）。
 *
 * - 本番 (Vercel + Neon): neon-serverless。WebSocket 経由で、
 *   サーバーレスでもコネクションが枯渇しない。
 * - ローカル開発:          node-postgres。Docker の PostgreSQL に TCP 接続する。
 *
 * neon-http ではなく neon-serverless を使うのは、Item と Section を
 * まとめて作る際にトランザクションが必要なため（neon-http は非対応）。
 */
export type Db = NodePgDatabase<typeof schema>

/** Db もしくはトランザクションのどちらでも受けられるようにする。 */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

function createDb(): Db {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL が設定されていません。.env.example をコピーして .env を作成してください。',
    )
  }

  if (url.includes('neon.tech')) {
    // 両ドライバはクエリAPIが同一なので、呼び出し側では同じ型として扱う
    return drizzleNeon(new NeonPool({ connectionString: url }), {
      schema,
    }) as unknown as Db
  }

  return drizzlePg(new PgPool({ connectionString: url }), { schema })
}

let instance: Db | undefined

/** DB クライアント。初回アクセス時に接続を作る。 */
export function useDb(): Db {
  instance ??= createDb()
  return instance
}

export { schema }
