import type { ConflictRecord, PendingOperation } from '~/utils/offline/local-database'
import { onFlushRequested } from '~/utils/offline/flush-signal'
import { rememberDeleted } from '~/utils/offline/deleted-snapshots'
import {
  deleteItem,
  dismissConflict,
  getItem,
  listConflicts,
  markSynced,
  putConflict,
} from '~/utils/offline/todo-repository'
import {
  cancelOperations,
  listOperations,
  nextOperation,
  recordFailure,
  removeOperation,
  retryGivenUp,
  summarize,
  type PatchPayload,
} from '~/utils/offline/sync-queue'
import { runOperation, type RequestFn, type SyncOutcome } from '~/utils/offline/sync-runner'

/**
 * 未送信の操作をサーバーへ流し込む係。
 *
 * オンラインになった / 画面に戻った / 新しい操作が積まれた、のいずれかで動く。
 * 送るのは常に**列の先頭から1つずつ**。追い越すと同じ Item への操作の
 * 前後が入れ替わる。
 *
 * 失敗しても操作は消さない。間隔を空けて送り直し、それでも駄目なら
 * 自動での送り直しをやめて画面に出す（docs/12-offline.md 12.7）。
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
   * パスは実行時に決まるため、Nitro の型付きルート推論には乗せない
   * （全ルートを突き合わせようとして型チェックが破綻する）。
   */
  const send = $fetch as unknown as RequestFn

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
      for (;;) {
        const operation = await nextOperation()
        if (!operation) break

        // 送信そのものは画面からの送信と同じ列に並べる（順序を守るため）
        const outcome = await enqueue(async () =>
          runOperation(await withCurrentBase(operation), send),
        )

        const stop = await apply(operation, outcome)
        if (outcome.type === 'done') sent += 1
        if (stop) break
      }
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

  /**
   * 送信の結果をローカルへ反映する。列を止めるべきなら true を返す。
   */
  async function apply(
    operation: PendingOperation,
    outcome: SyncOutcome,
  ): Promise<boolean> {
    switch (outcome.type) {
      case 'done': {
        await removeOperation(operation.opId)
        reachable.value = true
        lastError.value = null

        if (operation.kind === 'delete') {
          // 取り消しで元に戻せるよう、応答の控えを覚えておく
          if (outcome.detail) rememberDeleted(outcome.detail)
          const local = await getItem(operation.itemIds[0] ?? '')
          // 消したあとに復元が積まれている場合は、その記録を残す
          if (local?.syncState === 'pending_delete') await deleteItem(local.id)
        } else if (outcome.item) {
          // まだ同じ Item への操作が残っているなら、内容は上書きしない。
          // 上書きすると、送信中に行った変更が画面から消える
          const remaining = await listOperations()
          const keepPending = remaining.some((rest) =>
            rest.itemIds.includes(outcome.item!.id),
          )
          await markSynced(outcome.item, { keepPending })
        }

        await store.reload()
        return false
      }

      case 'conflict': {
        await handleConflict(operation, outcome)
        return false
      }

      case 'retry': {
        await recordFailure(operation.opId, outcome.message)
        if (outcome.offline) reachable.value = false
        lastError.value = outcome.message
        return true
      }

      case 'failed': {
        // 内容の問題なので投げ続けても通らない。消さずに印だけ付けて次へ
        await recordFailure(operation.opId, outcome.message, { permanent: true })
        lastError.value = outcome.message
        await store.reload()
        return false
      }
    }
  }

  /**
   * 競合したときの処理。
   *
   * サーバー側を正とする。ただし黙って捨てず、捨てたローカルの変更を
   * 記録して画面に出す（docs/12-offline.md 12.5）。
   * この Item に積まれていた未送信の操作は、まとめて取り下げる。
   */
  async function handleConflict(
    operation: PendingOperation,
    outcome: Extract<SyncOutcome, { type: 'conflict' }>,
  ): Promise<void> {
    const itemId = operation.itemIds[0]
    if (!itemId) {
      await removeOperation(operation.opId)
      return
    }

    const local = await getItem(itemId)
    await cancelOperations((rest) => rest.itemIds.includes(itemId))

    if (outcome.reason === 'server_deleted' || !outcome.server) {
      await deleteItem(itemId)
    } else {
      await markSynced(outcome.server)
    }

    await putConflict({
      itemId,
      title: local?.title ?? outcome.server?.title ?? '',
      detectedAt: new Date().toISOString(),
      discarded: discardedOf(operation),
      reason: outcome.reason,
    })

    reachable.value = true
    await store.reload()
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
   *
   * 掛けっぱなしにはせず、送るものが無ければ何もしない。
   */
  function scheduleNext(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    void listOperations().then((operations) => {
      const head = operations.find((operation) => !operation.givenUp)
      if (!head) return
      const delay = Math.max(1_000, new Date(head.nextAttemptAt).getTime() - Date.now())
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

/**
 * 競合の基準（サーバーで最後に見た updatedAt）を、送る直前の値に入れ替える。
 *
 * 積んだ時点の値をそのまま使うと、同じ Item への1つ前の操作が通って
 * サーバーの updatedAt が進んだ時点で、自分の変更なのに競合と見なされる。
 */
async function withCurrentBase(operation: PendingOperation): Promise<PendingOperation> {
  if (operation.kind !== 'patch') return operation
  const payload = operation.payload as PatchPayload
  const local = await getItem(payload.id)
  return {
    ...operation,
    payload: { ...payload, baseUpdatedAt: local?.baseUpdatedAt ?? null },
  }
}

/** 競合で採用しなかった内容。人が見て何を失ったか分かる形にする。 */
function discardedOf(operation: PendingOperation): Record<string, unknown> {
  if (operation.kind === 'patch') {
    return { ...(operation.payload as PatchPayload).patch }
  }
  return { operation: operation.kind }
}
