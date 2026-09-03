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

/**
 * 作業記録（Section）の保存。作成と更新を分けない。
 *
 * id は手元で決める。オフラインで書いた記録にもその場で id が要るためで、
 * 同じ id で二度届いてもサーバーは同じ1件を上書きするだけ（冪等）。
 * `date` と `body` は**送る直前に手元の最新へ入れ替える**
 * （sync-engine の `withCurrentBody`）。
 */
export interface SectionSavePayload {
  id: string
  itemId: string
  date: string
  body: string
  /**
   * 日記でのピン留め（docs/03-functional-spec.md 3.3）。
   *
   * 本文と同じ経路（PUT）で送る。ピンだけの操作を別に作ると、本文の保存と
   * 前後して届いたときにどちらが勝つのかが決められない。
   */
  pinned: boolean
}

export interface SectionDeletePayload {
  id: string
  itemId: string
}

export interface SectionReorderPayload {
  itemId: string
  ids: string[]
}

/** 日記の保存。日付が主キーなので、これも同じ内容を何度送っても変わらない。 */
export interface DiarySavePayload {
  date: string
  body: string
}

export interface NewOperation {
  kind: OperationKind
  itemIds: string[]
  payload:
    | CreatePayload
    | PatchPayload
    | DeletePayload
    | TagsPayload
    | RestorePayload
    | SectionSavePayload
    | SectionDeletePayload
    | SectionReorderPayload
    | DiarySavePayload
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
    itemIds: [...operation.itemIds],
    /*
     * 画面から渡された値には Vue が包んだもの（Proxy）が混じりうる。
     * そのままでは構造化複製できず DataCloneError になるので、
     * ここで素の値に直す。中身はいずれも JSON で表せるものだけ。
     */
    payload: JSON.parse(JSON.stringify(operation.payload)) as unknown,
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

/**
 * 同じ対象への未送信の操作があれば積み増さない。本文の保存に使う。
 *
 * 本文は打鍵のたびに変わるが、送る内容は**送信の直前に手元から取り直す**
 * ため、列に1つあれば足りる。打つたびに積むと、同じ内容の送信が
 * 打鍵の数だけ並んでしまう。
 *
 * すでに諦めた印が付いていたら、送り直せる状態に戻す（書き足したのに
 * いつまでも送られない、という状態を作らない）。
 */
export async function enqueueOnce(
  operation: NewOperation,
  matches: (existing: PendingOperation) => boolean,
  now: Date = new Date(),
): Promise<PendingOperation> {
  const db = await openLocalDatabase()
  const existing = (await db.getAll('operations')).find(matches)

  if (!existing) return await enqueueOperation(operation, now)

  if (!existing.givenUp) return existing

  const revived: PendingOperation = {
    ...existing,
    attempts: 0,
    givenUp: false,
    lastError: null,
    nextAttemptAt: now.toISOString(),
  }
  await db.put('operations', revived)
  return revived
}

/** 積まれた順に並べて返す。 */
export async function listOperations(): Promise<PendingOperation[]> {
  const db = await openLocalDatabase()
  return await db.getAll('operations')
}

/**
 * 順序を守る単位（宛先）。
 *
 * 同じ対象への操作は積んだ順に送らなければならない。完了にしてすぐ
 * 取り消す、のような続けざまの操作が入れ替わるためで、守りたいのは
 * **その1点だけ**。別の対象への操作どうしは互いに関係がない。
 *
 * 日記は Item を持たないので、日付そのものが宛先になる。
 */
function targetsOf(operation: PendingOperation): string[] {
  if (operation.kind === 'diary_save') {
    return [`diary:${(operation.payload as DiarySavePayload).date}`]
  }
  return operation.itemIds.map((id) => `item:${id}`)
}

/**
 * 次に送る操作。
 *
 * 待機中（送り直しの間隔待ち）の操作は、**同じ宛先の後続だけ**を押さえる。
 * 列の先頭で1つ詰まっただけで全部止めると、送れないタスクの操作の後ろで
 * 日記や別のタスクが待たされ、●が灰色のまま動かなくなる（間隔は最大10分。
 * その間じゅう、関係のない変更まで送られない）。
 *
 * 自動での送り直しをやめた操作（`givenUp`）は飛ばす。手で送り直すまで
 * 動かないものなので、後続をいつまでも押さえない。
 */
export async function nextOperation(
  now: Date = new Date(),
): Promise<PendingOperation | null> {
  const stamp = now.toISOString()
  /** 送れない操作が押さえている宛先。ここへの後続は追い越させない。 */
  const held = new Set<string>()

  for (const operation of await listOperations()) {
    if (operation.givenUp) continue

    const targets = targetsOf(operation)
    if (operation.nextAttemptAt > stamp || targets.some((target) => held.has(target))) {
      for (const target of targets) held.add(target)
      continue
    }

    return operation
  }

  return null
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

/**
 * 次に送る操作の様子。画面に「なぜ送れていないのか」を出すために持つ
 * （docs/12-offline.md 12.8）。
 */
export interface QueueHead {
  kind: OperationKind
  /** 送ろうとした回数。`MAX_ATTEMPTS` で自動の送り直しをやめる。 */
  attempts: number
  /** 次に送ってよい時刻（ISO）。 */
  nextAttemptAt: string
  lastError: string | null
  givenUp: boolean
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
  /**
   * 次に送る操作。すべて諦めていれば先頭のもの。列が空なら null。
   *
   * 「失敗しているのか、待っているだけなのか」は数だけでは分からない。
   * 試した回数と次に送る時刻を添えて、画面から読めるようにする。
   */
  head: QueueHead | null
  /** 種類ごとの件数（積んだ順）。何が送れていないのかを出すために使う。 */
  kinds: { kind: OperationKind; count: number }[]
}

export async function summarize(): Promise<QueueSummary> {
  const operations = await listOperations()
  const itemIds = new Set<string>()
  const counts = new Map<OperationKind, number>()
  let lastError: string | null = null

  for (const operation of operations) {
    for (const id of operation.itemIds) itemIds.add(id)
    if (operation.lastError) lastError = operation.lastError
    counts.set(operation.kind, (counts.get(operation.kind) ?? 0) + 1)
  }

  const head = operations.find((operation) => !operation.givenUp) ?? operations[0]

  return {
    pending: operations.length,
    givenUp: operations.filter((operation) => operation.givenUp).length,
    itemIds: [...itemIds],
    lastError,
    head: head
      ? {
          kind: head.kind,
          attempts: head.attempts,
          nextAttemptAt: head.nextAttemptAt,
          lastError: head.lastError,
          givenUp: head.givenUp,
        }
      : null,
    kinds: [...counts].map(([kind, count]) => ({ kind, count })),
  }
}
