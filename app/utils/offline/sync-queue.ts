import type { ItemDetailDto, ItemPatch } from '~~/shared/types/item'
import {
  openLocalDatabase,
  type OperationKind,
  type PendingOperation,
} from './local-database'

/**
 * 未送信の操作を並べておく列。
 *
 * 画面はローカルへ先に反映して先へ進むため、送信は後追いになる。
 * オフライン中の操作もここに積み、オンラインに戻ったら**積んだ順に**送る。
 * 順番を守らないと、続けざまの操作（完了にしてすぐ取り消す）が入れ替わる。
 *
 * 送信中のブラウザが閉じられても失われないよう、列は IndexedDB に置く
 * （画面の中だけで持つ useSyncQueue とは別）。
 */

/** 送り直す間隔。回を追うごとに空ける。 */
const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000, 600_000]

/** これだけ試して駄目なら自動での送り直しをやめる（無限に投げ続けない）。 */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length

export interface CreatePayload {
  id: string
  /** 追加時の入力そのまま。サーバーが SmartAdd として解釈する。 */
  text: string
}

export interface PatchPayload {
  id: string
  patch: ItemPatch & { tags?: string[] }
  /** 送る側が見ていたサーバーの updatedAt。競合の検出に使う。 */
  baseUpdatedAt: string | null
}

export interface DeletePayload {
  id: string
}

export interface TagsPayload {
  ids: string[]
  add: string[]
  remove: string[]
}

export interface RestorePayload {
  snapshot: ItemDetailDto
}

export interface NewOperation {
  kind: OperationKind
  itemIds: string[]
  payload: CreatePayload | PatchPayload | DeletePayload | TagsPayload | RestorePayload
}

/** 列の末尾へ積む。積んだ操作を返す。 */
export async function enqueueOperation(
  operation: NewOperation,
  now: Date = new Date(),
): Promise<PendingOperation> {
  // seq は IndexedDB が採番する（積んだ順そのもの）
  const record = {
    opId: crypto.randomUUID(),
    kind: operation.kind,
    itemIds: operation.itemIds,
    payload: operation.payload,
    createdAt: now.toISOString(),
    attempts: 0,
    nextAttemptAt: now.toISOString(),
    givenUp: false,
    lastError: null,
  } as PendingOperation

  const db = await openLocalDatabase()
  const seq = await db.add('operations', record)
  return { ...record, seq }
}

/** 積まれた順に並べて返す。 */
export async function listOperations(): Promise<PendingOperation[]> {
  const db = await openLocalDatabase()
  return await db.getAll('operations')
}

/**
 * 次に送る操作。
 *
 * 先頭が待機中（送り直しの間隔待ち）なら、後ろを追い越さずに何も返さない。
 * 追い越すと、同じ Item への操作の順序が崩れる。
 */
export async function nextOperation(
  now: Date = new Date(),
): Promise<PendingOperation | null> {
  const operations = await listOperations()
  const head = operations.find((operation) => !operation.givenUp)
  if (!head) return null
  return head.nextAttemptAt <= now.toISOString() ? head : null
}

export async function removeOperation(seq: number): Promise<void> {
  const db = await openLocalDatabase()
  await db.delete('operations', seq)
}

/**
 * 送信に失敗した。操作は消さず、次に送る時刻を後ろへ倒す。
 *
 * 一時的なエラー（通信断・サーバーの5xx）は間隔を空けて送り直し、
 * 決着しないもの（内容が不正・回数切れ）は自動での送り直しをやめて
 * UI から手で送り直せるようにする。
 */
export async function recordFailure(
  seq: number,
  message: string,
  options: { permanent?: boolean; now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date()
  const db = await openLocalDatabase()
  const tx = db.transaction('operations', 'readwrite')
  const operation = await tx.store.get(seq)

  if (operation) {
    const attempts = operation.attempts + 1
    const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]!
    await tx.store.put({
      ...operation,
      attempts,
      lastError: message,
      givenUp: Boolean(options.permanent) || attempts >= MAX_ATTEMPTS,
      nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
    })
  }

  await tx.done
}

/** 諦めた操作をもう一度送れるようにする（UI の「送り直す」）。 */
export async function retryGivenUp(now: Date = new Date()): Promise<void> {
  const db = await openLocalDatabase()
  const tx = db.transaction('operations', 'readwrite')
  for (const operation of await tx.store.getAll()) {
    if (!operation.givenUp) continue
    await tx.store.put({
      ...operation,
      givenUp: false,
      attempts: 0,
      nextAttemptAt: now.toISOString(),
    })
  }
  await tx.done
}

/**
 * まだ送っていない操作を取り消す。
 *
 * オフライン中の削除を Undo したときに使う。サーバーへ届く前なら、
 * 送らずに済ませるのが一番安全（送ってから戻すと履歴が濁る）。
 * 取り消した件数を返す。
 */
export async function cancelOperations(
  matches: (operation: PendingOperation) => boolean,
): Promise<number> {
  const db = await openLocalDatabase()
  const tx = db.transaction('operations', 'readwrite')
  let cancelled = 0
  for (const operation of await tx.store.getAll()) {
    if (!matches(operation)) continue
    await tx.store.delete(operation.seq)
    cancelled += 1
  }
  await tx.done
  return cancelled
}

export interface QueueSummary {
  /** 未送信の操作の数。 */
  pending: number
  /** そのうち、自動での送り直しをやめたものの数。 */
  givenUp: number
  /** 未送信の変更を抱えている Item の id。 */
  itemIds: string[]
  /** 直近の失敗の内容。 */
  lastError: string | null
}

export async function summarize(): Promise<QueueSummary> {
  const operations = await listOperations()
  const itemIds = new Set<string>()
  let lastError: string | null = null

  for (const operation of operations) {
    for (const id of operation.itemIds) itemIds.add(id)
    if (operation.lastError) lastError = operation.lastError
  }

  return {
    pending: operations.length,
    givenUp: operations.filter((operation) => operation.givenUp).length,
    itemIds: [...itemIds],
    lastError,
  }
}
