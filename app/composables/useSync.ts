import type { ConflictRecord } from '~/utils/offline/local-database'
import { onFlushRequested } from '~/utils/offline/flush-signal'
import { dismissConflict, listConflicts } from '~/utils/offline/todo-repository'
import { listOperations, retryGivenUp, summarize } from '~/utils/offline/sync-queue'
import { drainQueue } from '~/utils/offline/sync-engine'
import type { RequestFn } from '~/utils/offline/sync-runner'

/**
 * 未送信の操作をサーバーへ流し込む係。
 *
 * オンラインになった / 画面に戻った / 新しい操作が積まれた、のいずれかで動く。
 * 送る中身の決まりごとは sync-engine が持ち、ここは
 * 「いつ動かすか」と「画面に何を見せるか」だけを受け持つ。
 */

/** 同時に走らせない。composable は画面ごとに呼ばれるため、印はモジュールに置く。 */
let running = false
let started = false
let timer: ReturnType<typeof setTimeout> | null = null

export function useSync() {
  const store = useItemStore()
  const { browserOnline, reachable } = useOnline()

  const syncing = useState('offline:syncing', () => false)
  /** 未送信の操作の数。 */
  const pending = useState('offline:pending', () => 0)
  /** 自動での送り直しをやめた操作の数。 */
  const givenUp = useState('offline:given-up', () => 0)
  const lastError = useState<string | null>('offline:sync-error', () => null)
  const conflicts = useState<ConflictRecord[]>('offline:conflicts', () => [])
  /** 最後に何かを送り終えた時刻。タグ一覧の取り直しなどの合図に使う。 */
  const lastSyncedAt = useState<string | null>('offline:last-synced-at', () => null)

  /*
   * 送信そのもの。
   *
   * 画面からの送信（本文のリアルタイム保存など）と同じ列に並べて、
   * 投げた順に届くようにする。
   *
   * パスは実行時に決まるため、Nitro の型付きルート推論には乗せない
   * （全ルートを突き合わせようとして型チェックが破綻する）。
   */
  const send = $fetch as unknown as RequestFn
  const request: RequestFn = (path, options) => enqueue(() => send(path, options))

  async function refreshStatus(): Promise<void> {
    const summary = await summarize()
    pending.value = summary.pending
    givenUp.value = summary.givenUp
    conflicts.value = await listConflicts()
  }

  /**
   * 列を流す。
   *
   * ブラウザがオフラインだと分かっているときは何もしない。送っても失敗する
   * だけで、失敗の回数を数えてしまう（回数切れで諦めてしまう）ため。
   */
  async function flush(): Promise<void> {
    if (!import.meta.client) return
    if (running || !browserOnline.value) return

    running = true
    syncing.value = true

    let sent = 0
    try {
      const result = await drainQueue({
        request,
        onLocalChange: () => store.reload(),
        onReachable: (value) => {
          reachable.value = value
        },
        onError: (message) => {
          lastError.value = message
        },
      })
      sent = result.sent
    } finally {
      running = false
      syncing.value = false
    }

    await refreshStatus()

    if (sent > 0) {
      lastSyncedAt.value = new Date().toISOString()
      // 送ったことでサーバー側に増えたもの（繰り返しの次回分）も拾う
      if (pending.value === 0) await store.fetchFromServer()
    }

    scheduleNext()
  }

  /** 諦めた操作を送り直す（画面のボタンから）。 */
  async function retryFailed(): Promise<void> {
    await retryGivenUp()
    await refreshStatus()
    await flush()
  }

  /** 競合の知らせを閉じる。 */
  async function dismiss(itemId: string): Promise<void> {
    await dismissConflict(itemId)
    conflicts.value = await listConflicts()
  }

  /**
   * 次に送り直す時刻へ目覚ましを掛ける。
   * 送るものが無ければ掛けない。
   */
  function scheduleNext(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    void listOperations().then((operations) => {
      const head = operations.find((operation) => !operation.givenUp)
      if (!head) return
      const delay = Math.max(
        1_000,
        new Date(head.nextAttemptAt).getTime() - Date.now(),
      )
      timer = setTimeout(() => {
        timer = null
        void flush()
      }, delay)
    })
  }

  /** 起動時に1度だけ呼ぶ。監視を始め、溜まっているものを送る。 */
  function start(): void {
    if (!import.meta.client || started) return
    started = true

    onFlushRequested(() => void flush())

    window.addEventListener('online', () => void flush())

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      void flush()
      void store.refreshIfStale()
    })

    void refreshStatus()
    void flush()
  }

  return {
    syncing,
    pending,
    givenUp,
    lastError,
    conflicts,
    lastSyncedAt,
    flush,
    refreshStatus,
    retryFailed,
    dismiss,
    start,
  }
}
