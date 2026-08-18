/**
 * オンラインかどうか。
 *
 * `navigator.onLine` だけでは足りない。電波が繋がっているのに通信できない
 * （地下鉄・接続先が落ちている）ことがあるため、送信が通信エラーで
 * 失敗したかどうか（reachable）も合わせて見る。
 */
export function useOnline() {
  // SSR ではオンラインとみなす。実際の値はブラウザ側で起動時に入れる
  const browserOnline = useState('offline:browser-online', () => true)
  /** 直近の送信がサーバーへ届いたか。 */
  const reachable = useState('offline:reachable', () => true)

  const online = computed(() => browserOnline.value && reachable.value)

  return { online, browserOnline, reachable }
}

/**
 * ブラウザの online / offline を監視し始める。起動時に1度だけ呼ぶ。
 *
 * 監視はアプリが動いている間ずっと必要なので、外す手当ては用意しない。
 */
export function watchBrowserOnline(): void {
  if (!import.meta.client) return

  const { browserOnline, reachable } = useOnline()
  browserOnline.value = navigator.onLine

  window.addEventListener('online', () => {
    browserOnline.value = true
    // 繋がり直したのだから、届かない判定はいったん解く
    reachable.value = true
  })

  window.addEventListener('offline', () => {
    browserOnline.value = false
  })
}
