import type { H3Event } from 'h3'
import {
  LIFETIME,
  expiresIn,
  issueToken,
  readAuthConfig,
  verifyToken,
  type AuthConfig,
} from '~~/server/auth/core'

/**
 * 認証まわりの Nitro 側の道具（docs/19-auth.md）。中核は server/auth/core.ts。
 */

export const SESSION_COOKIE = 'lr_session'

let cached: { config: AuthConfig | null } | null = null
let warned = false

/**
 * 認証の設定。AUTH_SECRET と AUTH_PASSWORD_HASH が無ければ null（認証は無効）。
 *
 * 無効のときは、Deployment Protection で守っていた頃と同じく素通しにする。
 * 設定を入れる前にデプロイしても壊れないようにするため（切り替えの手順は
 * docs/19-auth.md）。ただし MCP は開けない（404）。鍵が無いまま開くと
 * 誰でも読み書きできてしまうため。
 */
export function useAuthConfig(): AuthConfig | null {
  if (!cached) {
    cached = { config: readAuthConfig() }
    if (!cached.config && !warned) {
      warned = true
      console.warn('[auth] AUTH_SECRET / AUTH_PASSWORD_HASH が未設定のため、認証は無効です')
    }
  }
  return cached.config
}

/** Cookie にログインの印があり、有効か。 */
export function hasSession(event: H3Event, config: AuthConfig): boolean {
  return verifyToken(config, getCookie(event, SESSION_COOKIE), 'session') !== null
}

/** `Authorization: Bearer` の MCP アクセストークンが有効か。 */
export function hasAccessToken(event: H3Event, config: AuthConfig): boolean {
  const header = getHeader(event, 'authorization')
  if (!header?.startsWith('Bearer ')) return false
  return verifyToken(config, header.slice('Bearer '.length), 'access') !== null
}

export function startSession(event: H3Event, config: AuthConfig) {
  setCookie(event, SESSION_COOKIE, issueToken(config, { typ: 'session', exp: expiresIn(LIFETIME.session) }), {
    httpOnly: true,
    // 開発（http://localhost）では Secure を付けると Cookie が保存されない
    secure: getRequestProtocol(event, { xForwardedProto: true }) === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: LIFETIME.session,
  })
}

export function endSession(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

/** このサーバーの起点（`https://example.com`）。OAuth の URL を組み立てるのに使う。 */
export function originOf(event: H3Event): string {
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
}

/** 失敗した認証の応答を遅らせる。総当たりの速度を落とす。 */
export function slowDown(ms = 1000): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** HTML の埋め込み用に文字をエスケープする。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * ログインと OAuth の許可画面の共通の枠。
 *
 * Nuxt の画面にしないのは、Service Worker がすべての画面遷移を殻で返すため
 * （docs/12-offline.md 12.2）と、ログイン前にアプリの JS を読ませないため。
 */
export function authPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} | datalake</title>
<style>
:root { color-scheme: light dark; --bg: #f6f6f4; --surface: #fff; --text: #1c1b17; --muted: #6b6a63; --border: #dcdbd5; --accent: #2f6b4f; --danger: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1b17; --surface: #262520; --text: #ecebe6; --muted: #a3a29a; --border: #3a3933; --accent: #5fa883; --danger: #f2b8b5; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Hiragino Sans", sans-serif; }
main { width: 100%; max-width: 22rem; display: grid; gap: 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; }
h1 { margin: 0; font-size: 1.25rem; }
p { margin: 0; color: var(--muted); font-size: 0.9375rem; }
form { display: grid; gap: 0.75rem; }
input { width: 100%; min-height: 2.75rem; padding: 0 0.75rem; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; }
button { min-height: 2.75rem; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; }
button.secondary { background: transparent; color: var(--muted); border: 1px solid var(--border); }
.error { color: var(--danger); }
code { overflow-wrap: anywhere; }
</style>
</head>
<body><main>${body}</main></body>
</html>`
}
