import { isPublicPath, isSameOrigin } from '~~/server/auth/core'

/**
 * アプリ全体をログインで守る（docs/19-auth.md）。
 *
 * 通すのは、ログイン済みの Cookie か、MCP のアクセストークン
 * （`Authorization: Bearer`）を持つリクエストだけ。後者は MCP が中で
 * API を呼ぶときに使う（server/routes/mcp.ts）。
 *
 * 弾き方は行き先で変える。API と画像は 401 を返し、画面はログインへ
 * 移す。API に HTML のログイン画面を返すと、呼んだ側が JSON として
 * 読めずに壊れるため。
 */
export default defineEventHandler(async (event) => {
  const config = useAuthConfig()
  if (!config) return

  const path = event.path
  if (isPublicPath(path)) return

  const viaCookie = hasSession(event, config)
  const viaToken = !viaCookie && hasAccessToken(event, config)

  if (viaCookie || viaToken) {
    // Cookie で通った書き込みは、同じサイトから来たものだけ（CSRF 対策）
    const method = event.method
    if (viaCookie && method !== 'GET' && method !== 'HEAD') {
      if (!isSameOrigin(getHeader(event, 'origin'), getRequestHost(event, { xForwardedHost: true }))) {
        throw createError({ statusCode: 403, message: '別のサイトからの送信は受け付けません' })
      }
    }
    return
  }

  if (path.startsWith('/api/') || path.startsWith('/images/')) {
    throw createError({ statusCode: 401, message: 'ログインが必要です' })
  }

  return sendRedirect(event, `/login?next=${encodeURIComponent(path)}`, 302)
})
