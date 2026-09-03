import type { ConflictRecord } from '~/utils/offline/local-database'
import { onFlushRequested } from '~/utils/offline/flush-signal'
import { dismissConflict, listConflicts } from '~/utils/offline/todo-repository'
import {
  listOperations,
  retryGivenUp,
  summarize,
  type QueueHead,
  type QueueSummary,
} from '~/utils/offline/sync-queue'
import { drainQueue } from '~/utils/offline/sync-engine'
import { resumePendingBodies } from '~/utils/offline/body-actions'
import { withSendTimeout, type RequestFn } from '~/utils/offline/sync-runner'

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
  const detailStore = useItemDetailStore()
  const diaryStore = useDiaryStore()
  const { browserOnline, reachable } = useOnline()

  const syncing = useState('offline:syncing', () => false)
  /** 未送信の操作の数。 */
  const pending = useState('offline:pending', () => 0)
  /** 自動での送り直しをやめた操作の数。 */
  const givenUp = useState('offline:given-up', () => 0)
  const lastError = useState<string | null>('offline:sync-error', () => null)
  /**
   * 次に送る操作の様子（種類・試した回数・次に送る時刻）。
   *
   * 数だけでは「失敗しているのか、待っているだけなのか」が分からない。
   * 画面（SyncStatus）から読めるように持つ（docs/12-offline.md 12.8）。
   */
  const head = useState<QueueHead | null>('offline:queue-head', () => null)
  /** 種類ごとの内訳。何が送れていないのかを出す。 */
  const kinds = useState<QueueSummary['kinds']>('offline:queue-kinds', () => [])
  /**
   * いま流している回で送り終えた数。
   *
   * これが伸び続けているのに未送信の数が減らなければ、同じ操作を送り直し
   * 続けている（回り続けている）。数字が動かないのと見分けるために出す。
   */
  const sentNow = useState('offline:sent-now', () => 0)
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
  // 応答が返らない送信で列が止まらないよう、1回ずつ上限を付ける
  const send = withSendTimeout($fetch as unknown as RequestFn)
  const request: RequestFn = (path, options) => enqueue(() => send(path, options))

  async function refreshStatus(): Promise<void> {
    const summary = await summarize()
    pending.value = summary.pending
    givenUp.value = summary.givenUp
    head.value = summary.head
    kinds.value = summary.kinds
    // 諦めた操作の失敗は列にも残っている。流していない間もそれを出す。
    // 思いがけない失敗（下の catch）を消してしまわないよう、あるときだけ当てる
    if (!running && summary.lastError) lastError.value = summary.lastError
    conflicts.value = await listConflicts()
  }

  /**
   * 列を流す。走っている間は重ねて走らせない。
   *
   * **`navigator.onLine` で止めない。** 以前は「オフラインだと分かっている
   * 間は送らない」（失敗の回数を数えて諦めてしまうため）としていたが、
   * この印は当てにならない。macOS アプリの WebView では実際には繋がって
   * いるのにオフラインと言うことがあり、そうなると**アプリを開き直すまで
   * 何ひとつ送られない**（起動時に読み直すまで印が変わらないため）。
   *
   * 届かない失敗で諦めないようにした（`recordFailure` の `offline`）ので、
   * 数えて困ることもない。本当にオフラインなら1回失敗して間隔が空くだけで、
   * 投げ続けることにはならない。
   */
  async function flush(): Promise<void> {
    if (!import.meta.client) return
    if (running) return

    running = true
    syncing.value = true
    sentNow.value = 0

    let sent = 0
    try {
      const result = await drainQueue({
        request,
        onProgress: (count) => {
          sentNow.value = count
        },
        // 送信の結果はローカルへ入るので、画面が見ている分を読み直す
        onLocalChange: async () => {
          await store.reload()
          await detailStore.reloadLoaded()
          await diaryStore.reloadLoaded()
        },
        onReachable: (value) => {
          reachable.value = value
          // 送れたのだから繋がっている。`navigator.onLine` が
          // 「オフライン」のまま固まっていたら、ここで直す
          if (value) browserOnline.value = true
        },
        onError: (message) => {
          lastError.value = message
        },
      })
      sent = result.sent
    } catch (error) {
      /*
       * 思いがけない失敗（IndexedDB の異常など）。列は残っているので次の合図で
       * 送り直せるが、**黙って止まると「未同期」が動かない理由が分からない**。
       * 画面に出したうえで、下の目覚まし（scheduleNext）まで進める。
       */
      lastError.value = error instanceof Error ? error.message : '同期を続けられませんでした'
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
   *
   * 起こす時刻は、列の先頭ではなく**いちばん早く送れるようになる操作**に
   * 合わせる。先頭が10分待ちでも、後ろの操作（別の宛先）はもっと早く
   * 送れることがあり、先頭に合わせるとその分まで待たせてしまう。
   */
  function scheduleNext(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    void listOperations().then((operations) => {
      const waiting = operations
        .filter((operation) => !operation.givenUp)
        .map((operation) => new Date(operation.nextAttemptAt).getTime())
      if (waiting.length === 0) return
      const delay = Math.max(1_000, Math.min(...waiting) - Date.now())
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

    // 手元にしか無い本文（作業記録・日記）を、送る列へ戻す。
    // 前回の起動で書いたまま送れていない分をここで拾う
    void resumePendingBodies().then(() => refreshStatus())

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
    head,
    kinds,
    sentNow,
    conflicts,
    lastSyncedAt,
    flush,
    refreshStatus,
    retryFailed,
    dismiss,
    start,
  }
}
