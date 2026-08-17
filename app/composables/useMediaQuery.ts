/**
 * メディアクエリの成否を追う。
 *
 * 分割表示のように、見た目だけでなく挙動も変える必要がある場合に使う
 * （狭い画面では詳細へ遷移、広い画面では右ペインに表示）。
 */
export function useMediaQuery(query: string) {
  // サーバー描画時は false。ハイドレーション後に実際の値へ切り替わる。
  const matches = ref(false)

  onMounted(() => {
    const list = window.matchMedia(query)
    matches.value = list.matches

    const update = (event: MediaQueryListEvent) => {
      matches.value = event.matches
    }
    list.addEventListener('change', update)
    onUnmounted(() => list.removeEventListener('change', update))
  })

  return matches
}

/** 一覧と詳細を並べられる幅か。 */
export function useSplitLayout() {
  return useMediaQuery('(min-width: 60rem)')
}
