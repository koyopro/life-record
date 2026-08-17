import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// Nuxt は .env を自動で読むが、drizzle-kit は読まないので明示的に読み込む。
// Vercel 上では .env が存在せず、環境変数が直接注入される。
if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
})
