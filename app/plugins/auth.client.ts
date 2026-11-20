import { isUnauthorizedResponse } from '~/utils/auth-redirect'

/**
 * ログインが切れたら、ログイン画面へ移す（docs/19-auth.md 19.3）。
 *
 * Service Worker が画面遷移をすべて殻で返すため（docs/12-offline.md 12.2）、
 * サーバーのリダイレクトでは画面がログインへ移らない。殻から起きたアプリが
 * API を呼んで 401 を受けた時点で、こちらから移す。
 *
 * 見張るのは `fetch` そのもの。`$fetch` を差し替えるだけでは足りない。
 * `useFetch` は Nuxt が内部に持つ `$fetch` を使い、`globalThis.$fetch` を
 * 見ないため。ofetch は呼ぶたびに `globalThis.fetch` を引くので、ここを
 * 包めば `useFetch`・`$fetch`・素の `fetch`（画像の取得）のどれも通る。
 *
 * 未送信の操作は消さない（401 は送り直しの対象。sync-runner.ts の classify）。
 * ログインし直して戻れば、そのまま送られる。
 */
export default defineNuxtPlugin({
  name: 'auth',
  enforce: 'pre',
  setup() {
    let leaving = false
    const original = globalThis.fetch.bind(globalThis)

    globalThis.fetch = async (input, init) => {
      const response = await original(input, init)
      if (!leaving && isUnauthorizedResponse(response, location.origin)) {
        leaving = true
        const next = `${location.pathname}${location.search}`
        location.assign(`/login?next=${encodeURIComponent(next)}`)
      }
      return response
    }
  },
})
