import { safeNextPath, verifyPassword } from '~~/server/auth/core'

/**
 * ログイン画面（docs/19-auth.md）。GET で画面を出し、POST でパスワードを確かめる。
 */
export default defineEventHandler(async (event) => {
  const config = useAuthConfig()
  const query = getQuery(event)

  if (!config) {
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
    return authPage(
      'ログイン',
      `<h1>ログイン</h1><p>認証が設定されていません（AUTH_SECRET / AUTH_PASSWORD_HASH）。</p><a href="/">アプリへ</a>`,
    )
  }

  let next = safeNextPath(query.next)
  let error = ''

  if (event.method === 'POST') {
    const form = await readBody<{ password?: unknown; next?: unknown }>(event)
    next = safeNextPath(form?.next)
    if (typeof form?.password === 'string' && verifyPassword(form.password, config.passwordHash)) {
      startSession(event, config)
      return sendRedirect(event, next, 303)
    }
    await slowDown()
    error = 'パスワードが違います'
    setResponseStatus(event, 401)
  } else if (hasSession(event, config)) {
    return sendRedirect(event, next, 302)
  }

  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'x-frame-options', 'DENY')
  return authPage(
    'ログイン',
    `<h1>ログイン</h1>
<form method="post" action="/login">
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <input type="password" name="password" autocomplete="current-password" aria-label="パスワード" placeholder="パスワード" required autofocus>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <button type="submit">ログイン</button>
</form>`,
  )
})
