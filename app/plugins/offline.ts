/**
 * TODO の読み込みと同期の起点。
 *
 * サーバー描画では最初の一覧をサーバーから取り、クライアントでは
 * IndexedDB を読んでから最新を取りに行く（docs/12-offline.md 12.4）。
 * 画面はどちらの経路でも useItemStore を見るだけでよい。
 */
export default defineNuxtPlugin(async () => {
  const store = useItemStore()

  if (import.meta.server) {
    // 最初の描画に間に合わせる。取れなくても画面は出し、続きはブラウザ側で
    await store.fetchFromServer()
    return
  }

  watchBrowserOnline()
  const sync = useSync()

  // 起動を待たせない。読み終わった時点で描き変わる
  void (async () => {
    await store.hydrateFromLocal()
    // 溜まっている未送信の操作を送り、以後の合図（オンライン復帰など）を待つ
    sync.start()
    // サーバー描画で取れていれば、ここでは取り直さない
    await store.refreshIfStale(15_000)
  })()
})
