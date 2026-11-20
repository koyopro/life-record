import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * 自前の認証の中核（docs/19-auth.md）。
 *
 * 単一ユーザーなので、アカウントやユーザーテーブルは持たない。「パスワードを
 * 知っているか」だけを確かめ、通ったら署名つきの文字列（トークン）を渡す。
 * トークンは DB に置かず、署名と期限だけで検証する。
 *
 * ここは Nitro に依存しない純粋な処理だけにする（テストから直接読むため）。
 */

export interface AuthConfig {
  /** トークンの署名に使う秘密（AUTH_SECRET）。 */
  secret: string
  /** パスワードのハッシュ（AUTH_PASSWORD_HASH、`hashPassword` の出力）。 */
  passwordHash: string
}

/** 環境変数から設定を読む。どちらかが無ければ null（認証は無効）。 */
export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const secret = env.AUTH_SECRET?.trim()
  const passwordHash = env.AUTH_PASSWORD_HASH?.trim()
  if (!secret || !passwordHash) return null
  if (secret.length < 32) throw new Error('AUTH_SECRET は32文字以上にしてください')
  if (!passwordHash.startsWith('scrypt:')) throw new Error('AUTH_PASSWORD_HASH の形式が不正です')
  return { secret, passwordHash }
}

// --- パスワード ------------------------------------------------------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 }

/**
 * パスワードをハッシュにする。`scrypt:N:r:p:salt:hash`（salt と hash は base64url）。
 *
 * 区切りに `$` を使わないのは、`.env` の読み込み（Nuxt）が `$` を変数として展開するため。
 */
export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  const hash = scryptSync(password.normalize('NFC'), salt, SCRYPT.keylen, SCRYPT)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join(':')
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, n, r, p, salt, hash] = stored.split(':')
  if (kind !== 'scrypt' || !n || !r || !p || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password.normalize('NFC'), Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// --- トークン --------------------------------------------------------------

/**
 * トークンの種類。種類を取り違えて受け付けない（リフレッシュトークンを
 * アクセストークンとして使う、など）よう、検証では必ず種類を指定する。
 */
export type TokenType = 'session' | 'client' | 'code' | 'access' | 'refresh'

export interface TokenPayload {
  typ: TokenType
  /** 期限（UNIX 秒）。無ければ期限なし（クライアント登録だけ）。 */
  exp?: number
  [key: string]: unknown
}

/**
 * 署名の鍵。秘密とパスワードのハッシュの両方から作る。
 *
 * パスワードを変えると鍵も変わるので、それまでに出したログインも
 * コネクタのトークンも一斉に無効になる。漏れたかもしれないときは
 * パスワードか AUTH_SECRET を変えれば済む。
 */
function signingKey(config: AuthConfig): Buffer {
  return createHmac('sha256', config.secret).update(config.passwordHash).digest()
}

function sign(config: AuthConfig, body: string): string {
  return createHmac('sha256', signingKey(config)).update(body).digest('base64url')
}

export function issueToken(config: AuthConfig, payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `v1.${body}.${sign(config, body)}`
}

/** 署名・種類・期限を確かめて中身を返す。どれかが合わなければ null。 */
export function verifyToken<T extends TokenPayload = TokenPayload>(
  config: AuthConfig,
  token: string | undefined | null,
  typ: TokenType,
  now: number = Date.now(),
): T | null {
  if (!token) return null
  const [version, body, signature] = token.split('.')
  if (version !== 'v1' || !body || !signature) return null

  const expected = Buffer.from(sign(config, body))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
    if (payload.typ !== typ) return null
    if (payload.exp !== undefined && payload.exp * 1000 <= now) return null
    return payload
  } catch {
    return null
  }
}

/** いまから `seconds` 秒後の UNIX 秒。 */
export function expiresIn(seconds: number, now: number = Date.now()): number {
  return Math.floor(now / 1000) + seconds
}

/** 有効期間（秒）。 */
export const LIFETIME = {
  /** アプリのログイン。PWA でオフラインのまま使う期間があるので長めにする。 */
  session: 365 * 24 * 60 * 60,
  /** 認可コード。すぐトークンに引き換えるものなので短く。 */
  code: 5 * 60,
  /** MCP のアクセストークン。 */
  access: 60 * 60,
  /** MCP のリフレッシュトークン。 */
  refresh: 90 * 24 * 60 * 60,
} as const

// --- PKCE / その他 ---------------------------------------------------------

/** PKCE（S256）の検証。`code_challenge = BASE64URL(SHA256(code_verifier))`。 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'))
  const given = Buffer.from(challenge)
  return computed.length === given.length && timingSafeEqual(computed, given)
}

/**
 * ログイン後の戻り先。同じサイト内のパスだけを許す。
 *
 * `//evil.example` や `https://...` を渡されて外へ飛ばされないようにする
 * （オープンリダイレクト）。
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/'
  }
  return next
}

/**
 * 認証なしで通すパスか。
 *
 * ログインそのもの、OAuth の入口、MCP（自分で Bearer を確かめる）、
 * アプリの起動に要る静的ファイル（中身を含まない）だけ。
 * それ以外の画面・API・画像はすべてログインを求める。
 */
export function isPublicPath(path: string): boolean {
  const pathname = path.split('?')[0]!
  if (pathname === '/login' || pathname === '/logout') return true
  if (pathname === '/mcp' || pathname.startsWith('/.well-known/') || pathname.startsWith('/oauth/')) return true
  // Nuxt のビルド成果物と、アプリの殻（オフライン用。中身は持たない）
  if (pathname.startsWith('/_nuxt/') || pathname === '/offline-shell' || pathname.startsWith('/__nuxt')) return true
  // PWA の起動に要るもの（manifest・Service Worker・アイコン）
  if (/^\/(manifest\.webmanifest|sw\.js|workbox-[\w-]+\.js|registerSW\.js|favicon\.ico|robots\.txt|icon-[\w-]+\.png|apple-touch-icon[\w-]*\.png)$/.test(pathname)) {
    return true
  }
  return false
}

/**
 * 書き込みのリクエストが同じサイトから来たか（CSRF 対策）。
 *
 * Cookie は SameSite=Lax なので他サイトからの POST には付かないが、
 * 念のため Origin も確かめる。Origin を付けない古いクライアント（同じサイトの
 * フォーム送信など）は通す。付いていて食い違うときだけ弾く。
 */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
