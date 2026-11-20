import { exchangeToken } from '~~/server/auth/oauth'

/** トークンエンドポイント（docs/19-auth.md）。 */
export default defineEventHandler(async (event) => {
  const config = requireAuthConfig()
  if (allowCors(event)) return ''
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: 'Method Not Allowed' })

  setResponseHeaders(event, { 'cache-control': 'no-store', pragma: 'no-cache' })
  try {
    return exchangeToken(config, (await readBody<Record<string, unknown>>(event)) ?? {})
  } catch (error) {
    return oauthError(event, error)
  }
})
