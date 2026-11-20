import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer, type ApiCall } from '~~/server/mcp/server'

/**
 * Claude のカスタムコネクタから読み書きするための MCP エンドポイント
 * （docs/18-mcp.md）。
 *
 * OAuth のアクセストークン（`Authorization: Bearer`）で守る（docs/19-auth.md）。
 * 無いか無効なら 401 と、どこで認可を取ればよいか（`WWW-Authenticate` の
 * `resource_metadata`）を返す。Claude はそれを見てログインの画面を開く。
 *
 * 認証が設定されていなければ、エンドポイントごと無いものとして扱う。
 * 鍵が無いまま開くと、誰でも読み書きできてしまうため。
 */
export default defineEventHandler(async (event) => {
  const config = useAuthConfig()
  if (!config) {
    throw createError({ statusCode: 404, message: 'Not Found' })
  }
  if (allowCors(event)) return ''

  if (!hasAccessToken(event, config)) {
    setResponseHeader(
      event,
      'www-authenticate',
      `Bearer resource_metadata="${originOf(event)}/.well-known/oauth-protected-resource"`,
    )
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  /*
   * セッションを持たない（stateless）。Vercel Functions はリクエストごとに
   * 別のインスタンスへ行きうるので、サーバー側に会話の状態を置けない。
   * 応答もストリームにせず JSON で返す。
   */
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  /*
   * 既存の API を HTTP を介さずに呼ぶ（Nitro の内部呼び出し）。内部呼び出しも
   * 認証のミドルウェアを通るので、受け取ったアクセストークンをそのまま渡す。
   * （$fetch の型は全ルートの応答型を展開して重すぎるため、型をほどいて渡す）
   */
  const authorization = getHeader(event, 'authorization')!
  const fetchApi = $fetch as unknown as (path: string, options?: object) => Promise<never>
  const api: ApiCall = (path, options) => fetchApi(path, { ...options, headers: { authorization } })
  const server = createMcpServer(api)
  await server.connect(transport)

  try {
    return await transport.handleRequest(toWebRequest(event))
  } finally {
    await server.close()
  }
})
