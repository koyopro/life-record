import { timingSafeEqual } from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer, type ApiCall } from '~~/server/mcp/server'

/**
 * Claude のカスタムコネクタから読み書きするための MCP エンドポイント
 * （docs/18-mcp.md）。
 *
 * サイト全体は Vercel の Deployment Protection で守っているが、Claude は
 * そのログインを通れない。Claude からは「Protection Bypass for Automation」の
 * 秘密をクエリに付けて届かせ、ここではさらに `MCP_TOKEN` を確かめる。
 * バイパスの秘密はサイト全体の鍵なので、MCP だけを別の鍵で閉じておく。
 *
 * `MCP_TOKEN` が無ければ、エンドポイントごと無いものとして扱う。
 */
export default defineEventHandler(async (event) => {
  const expected = process.env.MCP_TOKEN
  if (!expected) {
    throw createError({ statusCode: 404, message: 'Not Found' })
  }
  if (!isAuthorized(event, expected)) {
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
  // 既存の API を HTTP を介さずに呼ぶ（Nitro の内部呼び出し）
  // （$fetch の型は全ルートの応答型を展開して重すぎるため、型をほどいて渡す）
  const fetchApi = $fetch as unknown as (path: string, options?: object) => Promise<never>
  const api: ApiCall = (path, options) => fetchApi(path, options)
  const server = createMcpServer(api)
  await server.connect(transport)

  try {
    return await transport.handleRequest(toWebRequest(event))
  } finally {
    await server.close()
  }
})

function isAuthorized(event: Parameters<typeof getQuery>[0], expected: string): boolean {
  const header = getHeader(event, 'authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
  // claude.ai のカスタムコネクタはヘッダーを足せないため、クエリでも受ける
  const query = getQuery(event).token
  const given = bearer ?? (typeof query === 'string' ? query : undefined)
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
