import type { ItemDetailDto, ItemDto, ItemPatch } from '~~/shared/types/item'
import type { LocalItem } from '~/utils/offline/local-database'
import { requestFlush } from '~/utils/offline/flush-signal'
import { takeDeletedSnapshot } from '~/utils/offline/deleted-snapshots'
import {
  allItems,
  getItem,
  lastFetchedAt,
  mergeServerItems,
  pruneConflicts,
  putItem,
  toLocalItem,
} from '~/utils/offline/todo-repository'
import { cancelOperations, enqueueOperation } from '~/utils/offline/sync-queue'

/**
 * 画面が見る TODO の置き場。
 *
 * クライアントでは IndexedDB が唯一の読み取り元で、サーバーから取った内容も
 * いったんそこへ書いてから読み直す。こうすると、オンラインでもオフラインでも
 * 画面の作りが変わらない（docs/12-offline.md 12.4）。
 *
 * 操作はまずローカルへ書き、送信は列（SyncQueue）へ積むだけで待たない。
 * 実際に送るのは useSync。
 *
 * 絞り込みと並べ替えは持たない。ここは全件を持ち、一覧ごとの条件は
 * useItemList が計算する。
 */
export function useItemStore() {
  const items = useState<LocalItem[]>('offline:items', () => [])
  /** IndexedDB を読み終えたか。サーバー描画中は false。 */
  const hydrated = useState('offline:hydrated', () => false)
  const fetching = useState('offline:fetching', () => false)
  const fetchError = useState<string | null>('offline:fetch-error', () => null)
  const fetchedAt = useState<string | null>('offline:fetched-at', () => null)

  // サーバー描画中は Cookie を引き継ぐ必要がある（Vercel の保護を通すため）
  const request = useRequestFetch()

  // イベントハンドラの中からも呼ばれるため、Nuxt の文脈が要るものは
  // ここで受け取っておく（あとから呼ぶと文脈が失われている）
  const { online } = useOnline()

  /**
   * 表示できるものが何も無く、まだ読み込み中。
   *
   * ローカルに何かあるなら、取得の最中でも待たせない。
   */
  const loading = computed(
    () => items.value.length === 0 && (fetching.value || !hydrated.value),
  )

  function byId(id: string): LocalItem | undefined {
    return items.value.find((item) => item.id === id)
  }

  /** IndexedDB から読み直す。ローカルへ書いたあとは必ずこれを呼ぶ。 */
  async function reload(): Promise<void> {
    items.value = await allItems()
    hydrated.value = true
  }

  /**
   * サーバーから全件取り直して、ローカルへ重ねる。
   *
   * 一覧ごとに条件を変えて取りに行くのはやめ、全件を1回で取る。
   * 絞り込みはローカルで計算できるため、オフラインでも同じ画面が出せる。
   */
  async function fetchFromServer(): Promise<boolean> {
    if (fetching.value) return false
    fetching.value = true
    try {
      const list = await request<ItemDto[]>('/api/items', {
        query: { status: 'all', sort: 'created' },
      })
      const now = new Date()

      if (import.meta.client) {
        await mergeServerItems(list, now)
        await reload()
      } else {
        // サーバー描画。ここには IndexedDB が無いので、そのまま見せる
        items.value = list.map((item) => toLocalItem(item))
      }

      fetchedAt.value = now.toISOString()
      fetchError.value = null
      return true
    } catch {
      fetchError.value = '最新の内容を取得できませんでした'
      return false
    } finally {
      fetching.value = false
    }
  }

  /**
   * 起動時の読み込み。
   *
   * サーバー描画で受け取っていた内容は、サーバーの写しとしてローカルへ入れる
   * （初回アクセスでローカルが空のとき、これが最初のキャッシュになる）。
   */
  async function hydrateFromLocal(): Promise<void> {
    if (items.value.length > 0) await mergeServerItems(items.value)
    await reload()
    const stored = await lastFetchedAt()
    if (stored) fetchedAt.value = stored.toISOString()
    await pruneConflicts()
  }

  /** 前回の取得から時間が経っていれば取り直す。画面を開き直したときに呼ぶ。 */
  async function refreshIfStale(maxAgeMs = 30_000): Promise<void> {
    if (!online.value) return
    const previous = fetchedAt.value ? new Date(fetchedAt.value).getTime() : 0
    if (Date.now() - previous < maxAgeMs) return
    await fetchFromServer()
  }

  // --- 操作（ローカルへ先に反映し、送信は列へ積む） ----------------------

  /**
   * 追加する。
   *
   * id と内容はクライアントで決める（既存の仕様どおり）。サーバーには
   * 入力そのままを送り、SmartAdd の解釈はサーバー側でも同じ結果になる。
   */
  async function create(draft: ItemDto, text: string): Promise<void> {
    await putItem(toLocalItem(draft, 'pending_create'))
    await enqueueOperation({
      kind: 'create',
      itemIds: [draft.id],
      payload: { id: draft.id, text },
    })
    await reload()
    requestFlush()
  }

  /** 指定した Item をまとめて変更する。 */
  async function patch(ids: string[], values: ItemPatch): Promise<void> {
    const now = new Date().toISOString()

    for (const id of ids) {
      const local = await getItem(id)
      if (!local) continue
      await putItem(withPatch(local, values, now))
      await enqueueOperation({
        kind: 'patch',
        itemIds: [id],
        // 競合の基準は送る直前に useSync が入れ直す。
        // 前の操作が通れば基準は進むため、ここでの値は控えにすぎない
        payload: { id, patch: values, baseUpdatedAt: local.baseUpdatedAt },
      })
    }

    await reload()
    requestFlush()
  }

  /** タグを付け外しする。付ける・外すは集合の操作なので、何度送っても同じ。 */
  async function applyTags(
    ids: string[],
    add: string[],
    remove: string[],
  ): Promise<void> {
    if (add.length === 0 && remove.length === 0) return
    const now = new Date().toISOString()

    for (const id of ids) {
      const local = await getItem(id)
      if (!local) continue
      const tags = new Set(local.tags.filter((name) => !remove.includes(name)))
      for (const name of add) tags.add(name)

      await putItem({
        ...local,
        tags: [...tags].sort(),
        updatedAt: now,
        syncState: local.syncState === 'pending_create' ? 'pending_create' : 'pending_update',
      })
      await enqueueOperation({
        kind: 'tags',
        itemIds: [id],
        payload: { ids: [id], add, remove },
      })
    }

    await reload()
    requestFlush()
  }

  /**
   * 削除する。
   *
   * 記録はすぐには消さず、`pending_delete` の印を付けて残す。送信が通るまでは
   * 取り消せるようにしておきたいため。一覧は印を見て隠す。
   */
  async function remove(ids: string[]): Promise<void> {
    for (const id of ids) {
      const local = await getItem(id)
      if (!local) continue
      await putItem({ ...local, syncState: 'pending_delete' })
      await enqueueOperation({ kind: 'delete', itemIds: [id], payload: { id } })
    }
    await reload()
    requestFlush()
  }

  /**
   * 削除を取り消す。
   *
   * まだ送っていなければ、送らずに取り消す。すでに送ってしまっていたら、
   * 削除の応答として受け取った控えをサーバーへ戻す。
   */
  async function restore(ids: string[]): Promise<void> {
    for (const id of ids) {
      const cancelled = await cancelOperations(
        (operation) =>
          operation.kind === 'delete' && operation.itemIds.includes(id),
      )
      const local = await getItem(id)

      if (local && cancelled > 0) {
        await putItem({
          ...local,
          syncState: local.baseUpdatedAt ? 'synced' : 'pending_create',
        })
        continue
      }

      const snapshot = takeDeletedSnapshot(id) ?? (local ? toSnapshot(local) : null)
      if (!snapshot) continue

      await putItem(toLocalItem(pickItemFields(snapshot), 'pending_create'))
      await enqueueOperation({
        kind: 'restore',
        itemIds: [id],
        payload: { snapshot },
      })
    }

    await reload()
    requestFlush()
  }

  return {
    items,
    loading,
    fetching,
    fetchError,
    fetchedAt,
    hydrated,
    byId,
    reload,
    hydrateFromLocal,
    fetchFromServer,
    refreshIfStale,
    create,
    patch,
    applyTags,
    remove,
    restore,
  }
}

/**
 * ローカルの Item へ変更を当てる。
 *
 * サーバー（server/utils/item-patch.ts）と同じ結果になるようにする。
 * ずれていると、送信が通って取り直した瞬間に表示が変わってしまう。
 */
function withPatch(local: LocalItem, values: ItemPatch, now: string): LocalItem {
  const defined = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as ItemPatch

  const next: LocalItem = {
    ...local,
    ...defined,
    updatedAt: now,
    syncState:
      local.syncState === 'pending_create' ? 'pending_create' : 'pending_update',
  }

  // 期限を消したら、時刻指定の有無も意味を失う
  if (defined.dueAt === null) next.dueHasTime = false

  return next
}

/** ローカルの記録から、復元に渡せる形を作る。Section は持っていない。 */
function toSnapshot(local: LocalItem): ItemDetailDto {
  return { ...pickItemFields(local), sections: [], primarySectionId: null }
}

/** ItemDto の項目だけを取り出す。同期の印や Section を混ぜて保存しないため。 */
function pickItemFields(source: ItemDto): ItemDto {
  return {
    id: source.id,
    title: source.title,
    status: source.status,
    priority: source.priority,
    url: source.url,
    dueAt: source.dueAt,
    dueHasTime: source.dueHasTime,
    body: source.body,
    tags: source.tags,
    recurrenceRule: source.recurrenceRule,
    recurrenceBasis: source.recurrenceBasis,
    seriesId: source.seriesId,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}
