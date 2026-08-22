/**
 * Tauri CLI の起動口（docs/16-macos-app.md 16.5）。
 *
 * Tauri のウィンドウに出すのは Nuxt アプリそのもの。Nitro の API が要るので
 * 書き出した静的ファイルは同梱できず、行き先の URL を指すだけにしている。
 * その URL を LIFE_RECORD_APP_URL で差し替えられるようにする。
 *
 *   npm run tauri:dev                                  → http://localhost:3000
 *   LIFE_RECORD_APP_URL=https://… npm run tauri:build  → その URL を指す .app
 *
 * 指定しなければ tauri.conf.json のまま（どちらも http://localhost:3000）。
 */
import { spawn } from 'node:child_process'

const url = process.env.LIFE_RECORD_APP_URL?.trim()
const args = process.argv.slice(2)

if (url) {
  try {
    new URL(url)
  } catch {
    console.error(`LIFE_RECORD_APP_URL を URL として読めない: ${url}`)
    process.exit(1)
  }
  // tauri.conf.json への上書き。dev と build のどちらから来ても効くよう両方入れる
  args.push('--config', JSON.stringify({ build: { devUrl: url, frontendDist: url } }))
}

// tauri は node_modules/.bin にあり、npm scripts 経由なら PATH に載っている
const tauri = spawn('tauri', args, { stdio: 'inherit' })

tauri.on('error', (error) => {
  console.error(`tauri を起動できなかった: ${error.message}`)
  console.error('npm run tauri:dev / npm run tauri:build から実行する')
  process.exit(1)
})

tauri.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
