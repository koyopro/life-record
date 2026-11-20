/**
 * ログインが切れたら、ログイン画面へ移す（docs/19-auth.md）。
 *
 * Service Worker が画面遷移をすべて殻で返すため（docs/12-offline.md 12.2）、
 * サーバーのリダイレクトでは画面がログインへ移らない。殻から起きたアプリが
 * API を呼んで 401 を受けた時点で、こちらから移す。
 *
 * 未送信の操作は消さない（401 は送り直しの対象。sync-runner.ts の classify）。
 * ログインし直して戻れば、そのまま送られる。
 */
export default defineNuxtPlugin({
  name: 'auth',
  // 他のプラグインが $fetch を握る前に差し替える
  enforce: 'pre',
  setup() {
    let leaving = false

    function toLogin() {
      if (leaving) return
      leaving = true
      const next = `${location.pathname}${location.search}`
      location.assign(`/login?next=${encodeURIComponent(next)}`)
    }

    globalThis.$fetch = $fetch.create({
      onResponseError({ response }) {
        if (response.status === 401) toLogin()
      },
    }) as typeof globalThis.$fetch
  },
})
