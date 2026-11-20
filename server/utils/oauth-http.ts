import type { H3Event } from 'h3'
import { OAuthError } from '~~/server/auth/oauth'

/**
 * OAuth の入口で共通に使う道具（docs/19-auth.md）。
 *
 * 認可サーバーのメタデータ・登録・トークンは、ブラウザで動くクライアント
 * （MCP Inspector など）からも呼ばれるので CORS を開ける。Cookie は使わない
 * 入口なので、誰からでも呼べて困ることはない。
 */
export function allowCors(event: H3Event): boolean {
  setResponseHeaders(event, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  })
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return true
  }
  return false
}

/** OAuth のエラー応答（RFC 6749 5.2）。 */
export function oauthError(event: H3Event, error: unknown) {
  if (error instanceof OAuthError) {
    setResponseStatus(event, error.status)
    return { error: error.error, error_description: error.description }
  }
  throw error
}

/** 認証が設定されていなければ、OAuth の入口ごと無いものとして扱う。 */
export function requireAuthConfig() {
  const config = useAuthConfig()
  if (!config) throw createError({ statusCode: 404, message: 'Not Found' })
  return config
}
