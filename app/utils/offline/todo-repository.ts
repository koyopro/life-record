import type { ItemDto } from '~~/shared/types/item'
import {
  openLocalDatabase,
  type ConflictRecord,
  type LocalItem,
  type SyncState,
} from './local-database'

/**
 * TODO（Item）のローカル保管。
 *
 * IndexedDB への読み書きはここに集める。画面は useItemStore を通してしか
 * 触らない。サーバーから取り直した内容を重ねるときの規則（未送信の変更を
 * 上書きしない）も、この層が持つ。
 */

const LAST_FETCHED_AT = 'items.lastFetchedAt'

/** 競合の記録を残しておく日数。読まれないまま溜め続けない。 */
const CONFLICT_RETENTION_DAYS = 7

export async function allItems(): Promise<LocalItem[]> {
  const db = await openLocalDatabase()
  return await db.getAll('items')
}

export async function getItem(id: string): Promise<LocalItem | undefined> {
  const db = await openLocalDatabase()
  return await db.get('items', id)
}

export async function putItem(item: LocalItem): Promise<void> {
  const db = await openLocalDatabase()
  await db.put('items', item)
}

export async function deleteItem(id: string): Promise<void> {
  const db = await openLocalDatabase()
  await db.delete('items', id)
}

/**
 * サーバーから来た Item を、同期済みのローカル表現へ直す。
 *
 * IndexedDB へ入れるものは、Vue が包んだ値（Proxy）を含んでいてはいけない。
 * 構造化複製ができず DataCloneError になるため、ここで素の値に直す。
 */
export function toLocalItem(item: ItemDto, syncState: SyncState = 'synced'): LocalItem {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    url: item.url,
    dueAt: item.dueAt,
    dueHasTime: item.dueHasTime,
    body: item.body,
    tags: [...item.tags],
    recurrenceRule: item.recurrenceRule,
    recurrenceBasis: item.recurrenceBasis,
    seriesId: item.seriesId,
    completedAt: item.completedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    syncState,
    baseUpdatedAt: syncState === 'synced' ? item.updatedAt : null,
  }
}

/**
 * サーバーの一覧をローカルへ重ねる。
 *
 * 正本はサーバーなので、原則としてサーバーの内容で置き換える。
 * ただし**まだ送れていない変更は上書きしない**。上書きすると、
 * オフライン中に書いたものが取り直しのたびに消えてしまう。
 *
 * ローカルにあってサーバーに無いものは、他の端末で削除されたと見て消す
 * （未送信の操作が付いているものは残す）。
 */
export async function mergeServerItems(
  serverItems: ItemDto[],
  fetchedAt: Date = new Date(),
): Promise<void> {
  const db = await openLocalDatabase()
  const tx = db.transaction(['items', 'meta'], 'readwrite')
  const items = tx.objectStore('items')

  const locals = new Map<string, LocalItem>()
  for (const local of await items.getAll()) locals.set(local.id, local)

  const seen = new Set<string>()
  for (const server of serverItems) {
    seen.add(server.id)
    const local = locals.get(server.id)
    if (local && local.syncState !== 'synced') continue
    await items.put(toLocalItem(server))
  }

  for (const [id, local] of locals) {
    if (seen.has(id)) continue
    if (local.syncState === 'synced') await items.delete(id)
  }

  await tx.objectStore('meta').put({
    key: LAST_FETCHED_AT,
    value: fetchedAt.toISOString(),
  })

  await tx.done
}

/** 最後にサーバーから取れた時刻。無ければ null。 */
export async function lastFetchedAt(): Promise<Date | null> {
  const db = await openLocalDatabase()
  const record = await db.get('meta', LAST_FETCHED_AT)
  if (typeof record?.value !== 'string') return null
  const date = new Date(record.value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * 送信が通った Item を、サーバーが返した内容で確定させる。
 *
 * 送信中にさらにローカルで変更されていた場合（syncState が pending のまま
 * 新しい操作が積まれている場合）は、その操作が後から送られるので
 * ここでは同期済みにしない。
 */
export async function markSynced(
  server: ItemDto,
  options: { keepPending?: boolean } = {},
): Promise<void> {
  const db = await openLocalDatabase()
  const tx = db.transaction('items', 'readwrite')
  const local = await tx.store.get(server.id)

  if (options.keepPending && local) {
    // ローカルの内容は保ったまま、競合の基準だけ進める
    await tx.store.put({ ...local, baseUpdatedAt: server.updatedAt })
  } else {
    await tx.store.put(toLocalItem(server))
  }

  await tx.done
}

/** 同期状態を書き換える。送信の成否に応じて印を付け替えるために使う。 */
export async function setSyncState(
  id: string,
  syncState: SyncState,
): Promise<void> {
  const db = await openLocalDatabase()
  const tx = db.transaction('items', 'readwrite')
  const local = await tx.store.get(id)
  if (local) await tx.store.put({ ...local, syncState })
  await tx.done
}

// --- 競合の記録 ---------------------------------------------------------

export async function putConflict(record: ConflictRecord): Promise<void> {
  const db = await openLocalDatabase()
  await db.put('conflicts', record)
}

export async function listConflicts(): Promise<ConflictRecord[]> {
  const db = await openLocalDatabase()
  const records = await db.getAll('conflicts')
  return records.sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1))
}

export async function dismissConflict(itemId: string): Promise<void> {
  const db = await openLocalDatabase()
  await db.delete('conflicts', itemId)
}

/** 読まれないまま古くなった競合の記録を捨てる。起動時に呼ぶ。 */
export async function pruneConflicts(now: Date = new Date()): Promise<void> {
  const limit = new Date(
    now.getTime() - CONFLICT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const db = await openLocalDatabase()
  const tx = db.transaction('conflicts', 'readwrite')
  for (const record of await tx.store.getAll()) {
    if (record.detectedAt < limit) await tx.store.delete(record.itemId)
  }
  await tx.done
}
