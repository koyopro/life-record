import { verifyPassword } from '~~/server/auth/core'
import {
  OAuthError,
  approvalRedirect,
  denialRedirect,
  parseAuthorizeRequest,
  type AuthorizeRequest,
} from '~~/server/auth/oauth'

/** 認可リクエストのパラメーター。許可画面のフォームにも引き継ぐ。 */
const PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'state',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'resource',
] as const

/**
 * 認可エンドポイント（docs/19-auth.md）。
 *
 * GET で許可画面を出し、POST で許可・拒否を受ける。アプリにログイン済み
 * なら「許可」を押すだけ、そうでなければパスワードも入れる。
 * 画面には戻り先のホストを出す。知らないサービスがコネクタのふりをして
 * 許可を取りに来たときに、気づけるようにするため。
 */
export default defineEventHandler(async (event) => {
  const config = requireAuthConfig()
  setResponseHeader(event, 'cache-control', 'no-store')
  // 許可のボタンを別サイトの枠に埋め込んで押させる手口（クリックジャッキング）を防ぐ
  setResponseHeader(event, 'x-frame-options', 'DENY')

  const params: Record<string, unknown> =
    event.method === 'POST' ? ((await readBody<Record<string, unknown>>(event)) ?? {}) : getQuery(event)

  let request: AuthorizeRequest
  try {
    request = parseAuthorizeRequest(config, params)
  } catch (error) {
    if (!(error instanceof OAuthError)) throw error
    setResponseStatus(event, 400)
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
    return authPage('接続できません', `<h1>接続できません</h1><p>${escapeHtml(error.description)}</p>`)
  }

  const loggedIn = hasSession(event, config)
  let error = ''

  if (event.method === 'POST') {
    if (params.decision === 'deny') return sendRedirect(event, denialRedirect(request), 302)

    const passwordOk =
      typeof params.password === 'string' && params.password !== '' && verifyPassword(params.password, config.passwordHash)
    if (loggedIn || passwordOk) {
      // パスワードで通ったなら、この端末もログインした状態にしておく
      if (!loggedIn) startSession(event, config)
      return sendRedirect(event, approvalRedirect(config, request), 302)
    }
    await slowDown()
    error = 'パスワードが違います'
    setResponseStatus(event, 401)
  }

  const host = new URL(request.redirectUri).host
  const name = request.client.name || host
  const hidden = PARAMS.filter((key) => typeof params[key] === 'string')
    .map((key) => `<input type="hidden" name="${key}" value="${escapeHtml(params[key] as string)}">`)
    .join('')

  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  return authPage(
    '接続の許可',
    `<h1>接続の許可</h1>
<p><strong>${escapeHtml(name)}</strong> が、タスク・作業記録・日記の読み書きを求めています。</p>
<p>許可すると、戻り先 <code>${escapeHtml(host)}</code> に接続の鍵を渡します。心当たりがなければ拒否してください。</p>
<form method="post" action="/oauth/authorize">
  ${hidden}
  ${loggedIn ? '' : '<input type="password" name="password" autocomplete="current-password" aria-label="パスワード" placeholder="パスワード" required autofocus>'}
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <button type="submit" name="decision" value="allow">許可する</button>
  <button type="submit" name="decision" value="deny" class="secondary" formnovalidate>拒否する</button>
</form>`,
  )
})
