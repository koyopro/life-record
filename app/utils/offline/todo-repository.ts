import type { ItemDto } from '~~/shared/types/item'
import { keepsLocal } from './freshness'
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
 * 触らない。サーバーから取り直した内容の重ね方は、種類をまたいで同じ決まり
 * （`freshness.ts` の `keepsLocal`）に従う。
 */

const LAST_FETCHED_AT = 'items.lastFetchedAt'

/** 競合の記録を残しておく日数。読まれないまま溜め続けない。 */
const CONFLICT_RETENTION_DAYS = 7

/**
 * 消したことを覚えておく時間。
 *
 * 守りたいのは「削除より前に出した取得の応答が、削除の後で届く」ぶんだけ。
 * 行き違いは長くても数秒（取得の上限が30秒。`sync-runner.ts`）なので、
 * それを見込んで少し長めに取る。いつまでも覚えていると、他の端末で
 * 同じ id が戻されたとき（取り消しは同じ id で作り直す）に出てこなくなる。
 */
const TOMBSTONE_RETENTION_MS = 10 * 60_000

/**
 * ローカルへ書き込んだ回数。
 *
 * 画面が見ている配列は、**書き込みと前後して読み直される**ことがある
 * （送信の合間にも読み直すため。useSync の `onLocalChange`）。書き込みより
 * 前に始めた読み取りは、書く前の写しを返す。そのまま当てると入力した
 * そばから巻き戻るので、追い越されたかどうかが分かるように数えておく
 * （`readItems`。docs/15-client-state.md 14.2 の 7）。
 */
let writes = 0

/**
 * ローカルへ書き込む。**印を先に進めてから**行う。
 *
 * 先に進めるので、読み取りは「自分より後に始まった書き込み」も
 * 追い越しとして扱う（取引の順は IndexedDB が守るため、読み取りより先に
 * 始まった書き込みはその読み取りに入っている）。
 */
async function write<T>(action: () => Promise<T>): Promise<T> {
  writes += 1
  return await action()
}

export async function allItems(): Promise<LocalItem[]> {
  const db = await openLocalDatabase()
  return await db.getAll('items')
}

/**
 * 画面へ当てるために全件読む。
 *
 * 読んでいる間にローカルへ書き込みがあったら **null を返す**。その写しは
 * 書く前のものかもしれず、当てると書いたそばから巻き戻る（送信中は操作
 * 1つごとに読み直すので、打鍵と重なりやすい）。書いた側が必ず読み直すので、
 * ここでは捨ててよい。
 */
export async function readItems(): Promise<LocalItem[] | null> {
  const stamp = writes
  const list = await allItems()
  return writes === stamp ? list : null
}

export async function getItem(id: string): Promise<LocalItem | undefined> {
  const db = await openLocalDatabase()
  return await db.get('items', id)
}

export async function putItem(item: LocalItem): Promise<void> {
  await write(async () => {
    const db = await openLocalDatabase()
    await db.put('items', item)
  })
}

/**
 * 手元から消す。**消したことも覚えておく**（`tombstones`）。
 *
 * 呼ばれるのは、サーバーでも消えたと分かったときだけ（削除が通った・
 * 他の端末で消されていた）。取り消しで戻す前の `pending_delete` は
 * 印を付けるだけで、ここは通らない。
 */
export async function deleteItem(id: string, now: Date = new Date()): Promise<void> {
  await write(async () => {
    const db = await openLocalDatabase()
    const tx = db.transaction(['items', 'tombstones'], 'readwrite')
    await tx.objectStore('items').delete(id)
    await tx
      .objectStore('tombstones')
      .put({ id, deletedAt: now.toISOString() })
    await tx.done
  })
}

/** 消したことを忘れる。取り消し（`u`）で同じ id を戻すときに呼ぶ。 */
export async function forgetDeletedItem(id: string): Promise<void> {
  await write(async () => {
    const db = await openLocalDatabase()
    await db.delete('tombstones', id)
  })
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
    note: item.note,
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
 * ただし**手元のほうが新しいものは残す**（`keepsLocal`。未送信の変更と、
 * その応答より後に送り終えた分）。上書きすると、オフライン中に書いたものが
 * 取り直しのたびに消えたり、直したそばから巻き戻ったりする。
 *
 * ローカルにあってサーバーに無いものは、他の端末で削除されたと見て消す
 * （未送信の操作が付いているものは残す）。
 *
 * **消したばかりのものは書き戻さない**（`tombstones`）。手元から消えたものは
 * 「消した」と「まだ知らない」の区別が付かず、`keepsLocal` の守りが効かない。
 * 削除より前に出した取得の応答が後から届くと、消したものが一覧へ戻ってしまう
 * （リロードすると消えているのに、その場では戻って見える）。
 */
export async function mergeServerItems(
  serverItems: ItemDto[],
  /** サーバーがその応答を作った時刻（`Fetched.fetchedAt`）。 */
  serverFetchedAt: string,
  /** 取り直した時刻（手元の時計）。次に取り直すまでの判断に使う。 */
  fetchedAt: Date = new Date(),
): Promise<void> {
  await write(async () => {
    const db = await openLocalDatabase()
    const tx = db.transaction(['items', 'meta', 'tombstones'], 'readwrite')
    const items = tx.objectStore('items')
    const tombstones = tx.objectStore('tombstones')

    const locals = new Map<string, LocalItem>()
    for (const local of await items.getAll()) locals.set(local.id, local)

    // 古くなった覚え書きは捨てる。応答の行き違いは長くても数秒で、
    // これ以上残すと、他の端末で同じ id が戻されたときに出てこなくなる
    const expired = new Date(fetchedAt.getTime() - TOMBSTONE_RETENTION_MS).toISOString()
    const deleted = new Set<string>()
    for (const tombstone of await tombstones.getAll()) {
      if (tombstone.deletedAt < expired) {
        await tombstones.delete(tombstone.id)
        continue
      }
      deleted.add(tombstone.id)
    }

    const seen = new Set<string>()
    for (const server of serverItems) {
      seen.add(server.id)
      // 消したものが入っている＝この応答は削除より前に作られたもの
      if (deleted.has(server.id)) continue
      const local = locals.get(server.id)
      if (local && keepsLocal(local, serverFetchedAt)) continue
      await items.put(toLocalItem(server))
    }

    // サーバーの一覧から消えていれば、覚えておく必要はもう無い
    for (const id of deleted) {
      if (!seen.has(id)) await tombstones.delete(id)
    }

    for (const [id, local] of locals) {
      if (seen.has(id)) continue
      if (keepsLocal(local, serverFetchedAt)) continue
      await items.delete(id)
    }

    await tx.objectStore('meta').put({
      key: LAST_FETCHED_AT,
      value: fetchedAt.toISOString(),
    })

    await tx.done
  })
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
  await write(async () => {
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
  })
}

/**
 * 一覧カードに出す本文の写しだけを差し替える。
 *
 * 本文の正本は Section（サーバー）で、ここに置いているのはその写し
 * （`ItemDto.body`）。詳細で本文を保存した時点でサーバーには届いている
 * ため、送信は積まない。同期状態にも触らない（触ると、書いていない
 * メタデータまで未送信の扱いになる）。
 */
export async function setItemBody(id: string, body: string | null): Promise<void> {
  await write(async () => {
    const db = await openLocalDatabase()
    const tx = db.transaction('items', 'readwrite')
    const local = await tx.store.get(id)
    if (local && local.body !== body) await tx.store.put({ ...local, body })
    await tx.done
  })
}

/** 同期状態を書き換える。送信の成否に応じて印を付け替えるために使う。 */
export async function setSyncState(
  id: string,
  syncState: SyncState,
): Promise<void> {
  await write(async () => {
    const db = await openLocalDatabase()
    const tx = db.transaction('items', 'readwrite')
    const local = await tx.store.get(id)
    if (local) await tx.store.put({ ...local, syncState })
    await tx.done
  })
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
