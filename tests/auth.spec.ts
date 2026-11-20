// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  isPublicPath,
  isSameOrigin,
  issueToken,
  readAuthConfig,
  safeNextPath,
  verifyPassword,
  verifyPkce,
  verifyToken,
  type AuthConfig,
} from '~~/server/auth/core'
import {
  OAuthError,
  approvalRedirect,
  exchangeToken,
  parseAuthorizeRequest,
  registerClient,
} from '~~/server/auth/oauth'

/** 自前の認証（docs/19-auth.md）。 */

const config: AuthConfig = {
  secret: 'x'.repeat(40),
  passwordHash: hashPassword('correct horse battery'),
}

describe('パスワード', () => {
  it('正しいパスワードだけを通す', () => {
    expect(verifyPassword('correct horse battery', config.passwordHash)).toBe(true)
    expect(verifyPassword('wrong', config.passwordHash)).toBe(false)
  })

  it('区切りに $ を使わない（.env の変数展開で壊れないように）', () => {
    expect(config.passwordHash).toMatch(/^scrypt:/)
    expect(config.passwordHash).not.toContain('$')
  })

  it('壊れたハッシュでは通さない', () => {
    expect(verifyPassword('a', 'scrypt:broken')).toBe(false)
  })
})

describe('readAuthConfig', () => {
  it('どちらかが無ければ無効（null）', () => {
    expect(readAuthConfig({})).toBeNull()
    expect(readAuthConfig({ AUTH_SECRET: 'x'.repeat(40) })).toBeNull()
  })

  it('短い秘密は受け付けない', () => {
    expect(() => readAuthConfig({ AUTH_SECRET: 'short', AUTH_PASSWORD_HASH: config.passwordHash })).toThrow()
  })
})

describe('トークン', () => {
  it('署名・種類・期限を確かめる', () => {
    const now = Date.now()
    const token = issueToken(config, { typ: 'session', exp: Math.floor(now / 1000) + 60 })
    expect(verifyToken(config, token, 'session', now)).not.toBeNull()
    // 種類が違えば受け付けない
    expect(verifyToken(config, token, 'access', now)).toBeNull()
    // 期限切れ
    expect(verifyToken(config, token, 'session', now + 61_000)).toBeNull()
  })

  it('書き換えたものは受け付けない', () => {
    const token = issueToken(config, { typ: 'access' })
    const [v, , sig] = token.split('.')
    const forged = `${v}.${Buffer.from(JSON.stringify({ typ: 'access', exp: 9e9 })).toString('base64url')}.${sig}`
    expect(verifyToken(config, forged, 'access')).toBeNull()
  })

  it('パスワードを変えると、それまでのトークンは無効になる', () => {
    const token = issueToken(config, { typ: 'session' })
    const changed = { ...config, passwordHash: hashPassword('another password!') }
    expect(verifyToken(changed, token, 'session')).toBeNull()
  })
})

describe('isPublicPath', () => {
  it('ログイン・OAuth・MCP・静的ファイルだけを通す', () => {
    for (const path of ['/login', '/login?next=/', '/oauth/token', '/.well-known/oauth-authorization-server', '/mcp', '/_nuxt/app.js', '/sw.js', '/manifest.webmanifest', '/icon-192.png']) {
      expect(isPublicPath(path), path).toBe(true)
    }
    for (const path of ['/', '/today', '/api/items', '/api/export', '/images/abc.png', '/share?url=x', '/loginx', '/mcpx']) {
      expect(isPublicPath(path), path).toBe(false)
    }
  })
})

describe('safeNextPath', () => {
  it('サイト内のパスだけを戻り先にする', () => {
    expect(safeNextPath('/items/1?x=1')).toBe('/items/1?x=1')
    expect(safeNextPath('//evil.example')).toBe('/')
    expect(safeNextPath('/\\evil.example')).toBe('/')
    expect(safeNextPath('https://evil.example')).toBe('/')
    expect(safeNextPath(undefined)).toBe('/')
  })
})

describe('isSameOrigin', () => {
  it('Origin が付いていて食い違うときだけ弾く', () => {
    expect(isSameOrigin(undefined, 'a.example')).toBe(true)
    expect(isSameOrigin('https://a.example', 'a.example')).toBe(true)
    expect(isSameOrigin('https://evil.example', 'a.example')).toBe(false)
  })
})

describe('OAuth', () => {
  const verifier = 'v'.repeat(50)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const redirect = 'https://claude.ai/api/mcp/auth_callback'

  function authorize() {
    const { client_id } = registerClient(config, { redirect_uris: [redirect], client_name: 'Claude' })
    const request = parseAuthorizeRequest(config, {
      response_type: 'code',
      client_id,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'abc',
    })
    const url = new URL(approvalRedirect(config, request))
    return { client_id, url }
  }

  it('登録 → 認可 → トークンの流れで、/mcp に使えるアクセストークンが出る', () => {
    const { client_id, url } = authorize()
    expect(url.origin + url.pathname).toBe(redirect)
    expect(url.searchParams.get('state')).toBe('abc')

    const tokens = exchangeToken(config, {
      grant_type: 'authorization_code',
      code: url.searchParams.get('code'),
      client_id,
      redirect_uri: redirect,
      code_verifier: verifier,
    })
    expect(verifyToken(config, tokens.access_token, 'access')).not.toBeNull()

    const refreshed = exchangeToken(config, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id })
    expect(verifyToken(config, refreshed.access_token, 'access')).not.toBeNull()
  })

  it('PKCE の verifier が違えば引き換えない', () => {
    const { client_id, url } = authorize()
    expect(() =>
      exchangeToken(config, {
        grant_type: 'authorization_code',
        code: url.searchParams.get('code'),
        client_id,
        code_verifier: 'w'.repeat(50),
      }),
    ).toThrow(OAuthError)
  })

  it('登録していない戻り先には返さない', () => {
    const { client_id } = registerClient(config, { redirect_uris: [redirect] })
    expect(() =>
      parseAuthorizeRequest(config, {
        response_type: 'code',
        client_id,
        redirect_uri: 'https://evil.example/cb',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }),
    ).toThrow(OAuthError)
  })

  it('偽の client_id は受け付けない', () => {
    expect(() =>
      parseAuthorizeRequest(config, { response_type: 'code', client_id: 'nope', redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' }),
    ).toThrow(OAuthError)
  })

  it('http の戻り先は localhost だけ', () => {
    expect(() => registerClient(config, { redirect_uris: ['http://evil.example/cb'] })).toThrow(OAuthError)
    expect(registerClient(config, { redirect_uris: ['http://localhost:3333/cb'] }).client_id).toBeTruthy()
  })

  it('リフレッシュトークンをアクセストークンとしては使えない', () => {
    const { client_id, url } = authorize()
    const tokens = exchangeToken(config, { grant_type: 'authorization_code', code: url.searchParams.get('code'), client_id, code_verifier: verifier })
    expect(verifyToken(config, tokens.refresh_token, 'access')).toBeNull()
  })
})

describe('isUnauthorizedResponse', () => {
  const origin = 'https://app.example'

  it('自分の API・画像への 401 だけをログイン切れとみなす', async () => {
    const { isUnauthorizedResponse } = await import('~/utils/auth-redirect')
    expect(isUnauthorizedResponse({ status: 401, url: `${origin}/api/tags` }, origin)).toBe(true)
    expect(isUnauthorizedResponse({ status: 401, url: `${origin}/images/a.png` }, origin)).toBe(true)
    expect(isUnauthorizedResponse({ status: 200, url: `${origin}/api/tags` }, origin)).toBe(false)
    expect(isUnauthorizedResponse({ status: 401, url: 'https://s3.example/x' }, origin)).toBe(false)
    expect(isUnauthorizedResponse({ status: 401, url: `${origin}/oauth/token` }, origin)).toBe(false)
  })
})
