import { authorizationServerMetadata, protectedResourceMetadata } from '~~/server/auth/oauth'

/**
 * OAuth のメタデータ（docs/19-auth.md）。Claude はこれを見て、どこで
 * ログインさせればよいかを知る。
 *
 * server/routes の下に `.well-known` という名前のディレクトリを置くと、
 * 先頭がドットのため拾われないことがあるので、ここで受ける。
 * パスの後ろにリソースのパスが付く形（`/.well-known/oauth-protected-resource/mcp`）
 * でも同じものを返す（RFC 9728 3.1）。
 */
export default defineEventHandler((event) => {
  const path = event.path.split('?')[0]!
  const isResource = path === '/.well-known/oauth-protected-resource' || path.startsWith('/.well-known/oauth-protected-resource/')
  const isServer = path === '/.well-known/oauth-authorization-server' || path.startsWith('/.well-known/oauth-authorization-server/')
  if (!isResource && !isServer) return

  if (!useAuthConfig()) throw createError({ statusCode: 404, message: 'Not Found' })
  if (allowCors(event)) return ''

  const origin = originOf(event)
  return isResource ? protectedResourceMetadata(origin) : authorizationServerMetadata(origin)
})
