import type { PendingOperation } from './local-database'
import {
  deleteItem,
  getItem,
  markSynced,
  putConflict,
} from './todo-repository'
import {
  cancelOperations,
  listOperations,
  nextOperation,
  recordFailure,
  removeOperation,
  type PatchPayload,
} from './sync-queue'
import { rememberDeleted } from './deleted-snapshots'
import { runOperation, type RequestFn, type SyncOutcome } from './sync-runner'

/**
 * 列に溜まった操作を、順にサーバーへ流し込む処理。
 *
 * 画面（Vue）に依存させない。ここが同期の決まりごとの本体で、
 * 単体でも試せるようにしておきたいため。反応する状態の持ち回りと、
 * どの合図で動かすかは useSync が受け持つ。
 */

export interface EngineHooks {
  /** 実際の送信。useSync は画面からの送信と同じ列に並べて渡す。 */
  request: RequestFn
  /** ローカルの内容が変わった。画面に見せている配列を読み直させる。 */
  onLocalChange?: () => void | Promise<void>
  /** サーバーへ届いたか。オフライン表示の判断に使う。 */
  onReachable?: (reachable: boolean) => void
  /** 直近の失敗の内容。 */
  onError?: (message: string | null) => void
  /** 時刻。テストから差し替える。 */
  now?: () => Date
}

export interface DrainResult {
  /** 送れた操作の数。 */
  sent: number
  /** 送れずに残った理由（あれば）。 */
  stoppedBy: 'retry' | 'empty'
}

/**
 * 列の先頭から順に送る。
 *
 * 一時的な失敗（通信断・サーバーの5xx）に当たったらそこで止める。
 * 後ろを先に送ると、同じ Item への操作の前後が入れ替わるため。
 */
export async function drainQueue(hooks: EngineHooks): Promise<DrainResult> {
  const now = hooks.now ?? (() => new Date())
  let sent = 0

  for (;;) {
    const operation = await nextOperation(now())
    if (!operation) return { sent, stoppedBy: 'empty' }

    const outcome = await runOperation(await withCurrentBase(operation), hooks.request)
    const stop = await applyOutcome(operation, outcome, hooks)

    if (outcome.type === 'done') sent += 1
    if (stop) return { sent, stoppedBy: 'retry' }
  }
}

/**
 * 送信の結果をローカルへ反映する。列を止めるべきなら true を返す。
 */
export async function applyOutcome(
  operation: PendingOperation,
  outcome: SyncOutcome,
  hooks: EngineHooks,
): Promise<boolean> {
  const now = hooks.now ?? (() => new Date())

  switch (outcome.type) {
    case 'done': {
      await removeOperation(operation.seq)
      hooks.onReachable?.(true)
      hooks.onError?.(null)

      if (operation.kind === 'delete') {
        // 取り消しで元に戻せるよう、応答の控えを覚えておく
        if (outcome.detail) rememberDeleted(outcome.detail)
        const id = operation.itemIds[0]
        const local = id ? await getItem(id) : undefined
        // 送信中に復元されていたら、その記録は消さない
        if (local?.syncState === 'pending_delete') await deleteItem(local.id)
      } else if (outcome.item) {
        /*
         * まだ同じ Item への操作が残っているなら、内容は上書きしない。
         * 上書きすると、送信中に行った変更が画面から消える。
         * 競合の基準（baseUpdatedAt）だけは進めておく。
         */
        const remaining = await listOperations()
        const keepPending = remaining.some((rest) =>
          rest.itemIds.includes(outcome.item!.id),
        )
        await markSynced(outcome.item, { keepPending })
      }

      await hooks.onLocalChange?.()
      return false
    }

    case 'conflict': {
      await handleConflict(operation, outcome, hooks, now())
      return false
    }

    case 'retry': {
      // 消さずに残す。次に送ってよい時刻だけ後ろへ倒す
      await recordFailure(operation.seq, outcome.message, { now: now() })
      if (outcome.offline) hooks.onReachable?.(false)
      hooks.onError?.(outcome.message)
      return true
    }

    case 'failed': {
      // 内容の問題なので投げ続けても通らない。印だけ付けて次へ進む
      await recordFailure(operation.seq, outcome.message, {
        permanent: true,
        now: now(),
      })
      hooks.onError?.(outcome.message)
      await hooks.onLocalChange?.()
      return false
    }
  }
}

/**
 * 競合したときの処理。
 *
 * サーバー側を正とする。ただし黙って捨てず、捨てたローカルの変更を
 * 記録して画面に出す（docs/12-offline.md 12.5）。この Item に積まれていた
 * 未送信の操作は、まとめて取り下げる（サーバー側を採ると決めた以上、
 * 後続の操作を送れば同じことを繰り返す）。
 */
async function handleConflict(
  operation: PendingOperation,
  outcome: Extract<SyncOutcome, { type: 'conflict' }>,
  hooks: EngineHooks,
  now: Date,
): Promise<void> {
  const itemId = operation.itemIds[0]
  if (!itemId) {
    await removeOperation(operation.seq)
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
    detectedAt: now.toISOString(),
    discarded: discardedOf(operation),
    reason: outcome.reason,
  })

  hooks.onReachable?.(true)
  await hooks.onLocalChange?.()
}

/**
 * 競合の基準（サーバーで最後に見た updatedAt）を、送る直前の値に入れ替える。
 *
 * 積んだ時点の値をそのまま使うと、同じ Item への1つ前の操作が通って
 * サーバーの updatedAt が進んだ時点で、自分の変更なのに競合と見なされる。
 */
export async function withCurrentBase(
  operation: PendingOperation,
): Promise<PendingOperation> {
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
