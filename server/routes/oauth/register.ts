import { registerClient } from '~~/server/auth/oauth'

/** 動的クライアント登録（RFC 7591、docs/19-auth.md）。 */
export default defineEventHandler(async (event) => {
  const config = requireAuthConfig()
  if (allowCors(event)) return ''
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: 'Method Not Allowed' })

  try {
    const client = registerClient(config, await readBody(event))
    setResponseStatus(event, 201)
    return client
  } catch (error) {
    return oauthError(event, error)
  }
})
