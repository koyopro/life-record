import {
  LIFETIME,
  expiresIn,
  issueToken,
  verifyPkce,
  verifyToken,
  type AuthConfig,
  type TokenPayload,
} from './core'

/**
 * MCP のための OAuth 2.1（docs/19-auth.md）。Claude のカスタムコネクタが
 * 「サインイン」で繋ぐときに使う。
 *
 * MCP の認可仕様（2025-06-18）に沿って、認可サーバーもこのアプリが兼ねる。
 * 本人確認はアプリのログインと同じパスワード。ユーザーは1人なので、
 * 誰として認可するかは考えない。
 *
 * クライアント登録・認可コード・トークンはどれも署名つきの文字列で、
 * DB には置かない。全部を無効にしたいときは、パスワードか AUTH_SECRET を
 * 変える。
 */

export interface ClientPayload extends TokenPayload {
  typ: 'client'
  redirectUris: string[]
  name: string
}

interface CodePayload extends TokenPayload {
  typ: 'code'
  clientId: string
  redirectUri: string
  challenge: string
  resource?: string
}

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description)
  }
}

/** 認可サーバーのメタデータ（RFC 8414）。 */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  }
}

/** 保護されたリソースのメタデータ（RFC 9728）。 */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  }
}

/**
 * 戻り先として受け付ける URL か。https か、手元（localhost）の http だけ。
 * Claude Code などは手元で待ち受けるため、localhost の http も許す。
 */
export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri)
    if (url.hash) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

/** 動的クライアント登録（RFC 7591）。登録内容を署名した文字列を client_id にする。 */
export function registerClient(config: AuthConfig, body: unknown, now = Date.now()) {
  const input = (body ?? {}) as { redirect_uris?: unknown; client_name?: unknown }
  const redirectUris = input.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris が必要です')
  }
  for (const uri of redirectUris) {
    if (typeof uri !== 'string' || !isAllowedRedirectUri(uri)) {
      throw new OAuthError('invalid_redirect_uri', `使えない redirect_uri です: ${String(uri)}`)
    }
  }
  const name = typeof input.client_name === 'string' ? input.client_name.slice(0, 100) : ''

  const clientId = issueToken(config, { typ: 'client', redirectUris, name } satisfies ClientPayload)
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now / 1000),
    client_name: name || undefined,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

export interface AuthorizeRequest {
  clientId: string
  client: ClientPayload
  redirectUri: string
  state: string | undefined
  challenge: string
  resource: string | undefined
}

/**
 * 認可リクエストを確かめる。
 *
 * client_id と redirect_uri が食い違うときは、戻り先へ返さずにその場で
 * エラーを出す（RFC 6749 4.1.2.1）。知らない戻り先へコードを渡さないため。
 */
export function parseAuthorizeRequest(config: AuthConfig, params: Record<string, unknown>): AuthorizeRequest {
  const str = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : undefined)

  const clientId = str('client_id')
  const client = verifyToken<ClientPayload>(config, clientId, 'client')
  if (!clientId || !client) throw new OAuthError('invalid_client', '登録されていないクライアントです')

  const redirectUri = str('redirect_uri') ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined)
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    throw new OAuthError('invalid_request', 'redirect_uri が登録と一致しません')
  }

  if (str('response_type') !== 'code') throw new OAuthError('unsupported_response_type', 'response_type は code だけです')
  const challenge = str('code_challenge')
  if (!challenge || str('code_challenge_method') !== 'S256') {
    throw new OAuthError('invalid_request', 'PKCE（S256）が必要です')
  }

  return { clientId, client, redirectUri, state: str('state'), challenge, resource: str('resource') }
}

/** 許可されたら、戻り先へ認可コードを付けて返す URL を作る。 */
export function approvalRedirect(config: AuthConfig, request: AuthorizeRequest): string {
  const code = issueToken(config, {
    typ: 'code',
    exp: expiresIn(LIFETIME.code),
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    challenge: request.challenge,
    resource: request.resource,
  } satisfies CodePayload)
  const url = new URL(request.redirectUri)
  url.searchParams.set('code', code)
  if (request.state !== undefined) url.searchParams.set('state', request.state)
  return url.toString()
}

/** 断られたときに戻り先へ返す URL。 */
export function denialRedirect(request: AuthorizeRequest): string {
  const url = new URL(request.redirectUri)
  url.searchParams.set('error', 'access_denied')
  if (request.state !== undefined) url.searchParams.set('state', request.state)
  return url.toString()
}

function tokenResponse(config: AuthConfig, clientId: string) {
  return {
    access_token: issueToken(config, { typ: 'access', exp: expiresIn(LIFETIME.access) }),
    token_type: 'Bearer',
    expires_in: LIFETIME.access,
    refresh_token: issueToken(config, { typ: 'refresh', exp: expiresIn(LIFETIME.refresh), clientId }),
    scope: 'mcp',
  }
}

/**
 * トークンエンドポイント。認可コードかリフレッシュトークンを、新しい
 * アクセストークン（とリフレッシュトークン）に引き換える。
 *
 * 認可コードは保存しないので、期限（5分）内なら理屈の上では二度使える。
 * ただし PKCE の verifier を持つ本人にしか引き換えられないので、
 * コードだけを盗まれても使えない。
 */
export function exchangeToken(config: AuthConfig, params: Record<string, unknown>) {
  const str = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : undefined)
  const clientId = str('client_id')

  if (str('grant_type') === 'authorization_code') {
    const code = verifyToken<CodePayload>(config, str('code'), 'code')
    if (!code) throw new OAuthError('invalid_grant', '認可コードが無効か、期限切れです')
    if (clientId !== undefined && clientId !== code.clientId) {
      throw new OAuthError('invalid_grant', 'client_id が一致しません')
    }
    if (str('redirect_uri') !== undefined && str('redirect_uri') !== code.redirectUri) {
      throw new OAuthError('invalid_grant', 'redirect_uri が一致しません')
    }
    const verifier = str('code_verifier')
    if (!verifier || !verifyPkce(verifier, code.challenge)) {
      throw new OAuthError('invalid_grant', 'code_verifier が一致しません')
    }
    return tokenResponse(config, code.clientId)
  }

  if (str('grant_type') === 'refresh_token') {
    const refresh = verifyToken<TokenPayload & { clientId: string }>(config, str('refresh_token'), 'refresh')
    if (!refresh) throw new OAuthError('invalid_grant', 'リフレッシュトークンが無効か、期限切れです')
    if (clientId !== undefined && clientId !== refresh.clientId) {
      throw new OAuthError('invalid_grant', 'client_id が一致しません')
    }
    return tokenResponse(config, refresh.clientId)
  }

  throw new OAuthError('unsupported_grant_type', 'grant_type は authorization_code か refresh_token です')
}
