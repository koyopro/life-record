/**
 * ログインが切れたことを示す応答か（docs/19-auth.md 19.3）。
 *
 * このアプリ自身の API・画像への 401 だけを見る。外のサービス（S3 の
 * 署名付き URL など）の 401 でログイン画面へ移ってしまわないように。
 */
export function isUnauthorizedResponse(response: Pick<Response, 'status' | 'url'>, origin: string): boolean {
  if (response.status !== 401 || !response.url) return false
  try {
    const url = new URL(response.url)
    return url.origin === origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/images/'))
  } catch {
    return false
  }
}
