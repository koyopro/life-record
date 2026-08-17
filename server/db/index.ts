import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { neon } from '@neondatabase/serverless'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * 環境によってドライバを使い分ける（docs/04-architecture.md 4.4）。
 *
 * - 本番 (Vercel + Neon): HTTP 経由。サーバーレスでコネクションが枯渇しない
 * - ローカル開発:          通常の TCP コネクションプール
 */
function createDb() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL が設定されていません。.env.example をコピーして .env を作成してください。',
    )
  }

  if (url.includes('neon.tech')) {
    return drizzleNeon(neon(url), { schema })
  }

  return drizzlePg(new Pool({ connectionString: url }), { schema })
}

let instance: ReturnType<typeof createDb> | undefined

/** DB クライアント。初回アクセス時に接続を作る。 */
export function useDb() {
  instance ??= createDb()
  return instance
}

export { schema }
