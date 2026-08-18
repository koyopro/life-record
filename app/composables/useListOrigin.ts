/** 一覧へ戻れなかったときの行き先。タスク一覧を既定とする。 */
const FALLBACK = '/items'

/**
 * 詳細画面から「← 一覧へ」で戻る先。
 *
 * 直前に見ていた一覧（今日 / Inbox / タスク / 検索 …）へ戻す。
 * 一覧ごとに詳細画面を分けていないため、戻り先は履歴から取る。
 *
 * URL に持たせない（`?from=` を付けない）のは、詳細の URL を共有・
 * ブックマークしたときに、他人の画面遍歴まで付いて回るのを避けるため。
 */
export function useListOrigin() {
  const router = useRouter()

  // サーバー描画の時点では履歴がないので、既定値から始める。
  // マウント後に差し替えることで、ハイドレーションのずれも起こさない。
  const path = ref(FALLBACK)

  onMounted(() => {
    // vue-router が履歴の各エントリに前後のパスを持たせている。
    // 再読み込みしてもブラウザが復元するため、直接開いた場合と区別できる。
    const back = router.options.history.state?.back
    if (typeof back === 'string' && isListPath(back)) path.value = back
  })

  return path
}

/**
 * 一覧として扱えるパスか。
 *
 * 詳細から詳細へ移れる（繰り返しの過去分）ので、詳細は戻り先にしない。
 * 「一覧へ」が詳細に戻ると、そこから抜け出せなくなる。
 */
function isListPath(path: string): boolean {
  // `//example.com` は外部への遷移になるため弾く
  if (!path.startsWith('/') || path.startsWith('//')) return false
  return !/^\/items\/[^/]/.test(path)
}
