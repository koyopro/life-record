/**
 * TODO の読み込みと同期の起点。
 *
 * サーバー描画では最初の一覧をサーバーから取り、クライアントでは
 * IndexedDB を読んでから最新を取りに行く（docs/12-offline.md 12.4）。
 * 画面はどちらの経路でも useItemStore を見るだけでよい。
 */
export default defineNuxtPlugin(async (nuxtApp) => {
  const store = useItemStore()

  if (import.meta.server) {
    // 最初の描画に間に合わせる。取れなくても画面は出し、続きはブラウザ側で。
    // 一覧を出さない画面（日記・検索・タグ）でまで引くと、その都度
    // 無駄に DB を叩くことになるので、必要な画面だけにする
    const path = nuxtApp.$router.currentRoute.value.path
    if (showsItems(path)) await store.fetchFromServer()
    return
  }

  watchBrowserOnline()
  // 画面の設定（並び・グループ順）も、送れなかった分を繋がり直しで送る
  watchSettingsRetry()
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

/**
 * TODO の一覧を出す画面か。
 *
 * 外れていても壊れない（ブラウザ側で取り直す）。サーバー描画のときに
 * 引くかどうかだけを決める。
 */
function showsItems(path: string): boolean {
  return path === '/' || path === '/today' || path.startsWith('/items')
}
