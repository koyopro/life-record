/**
 * ログアウト。この端末のログインの印を消す（docs/19-auth.md）。
 *
 * 他の端末や Claude のコネクタまで止めたいときは、パスワードか AUTH_SECRET を
 * 変える（署名の鍵が変わり、すべて無効になる）。
 */
export default defineEventHandler((event) => {
  endSession(event)
  return sendRedirect(event, '/login', 303)
})
