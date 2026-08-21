import type { ItemDto, ItemPatch } from '~~/shared/types/item'
import type { LocalItem } from '~/utils/offline/local-database'
import { requestFlush } from '~/utils/offline/flush-signal'
import { isNetworkError } from '~/utils/offline/sync-runner'
import {
  allItems,
  lastFetchedAt,
  mergeServerItems,
  pruneConflicts,
  setItemBody,
  toLocalItem,
} from '~/utils/offline/todo-repository'
import {
  applyTodoTags,
  createTodo,
  patchTodos,
  removeTodos,
  restoreTodos,
} from '~/utils/offline/todo-actions'

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
  const { browserOnline, reachable } = useOnline()

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
      reachable.value = true
      return true
    } catch (e) {
      fetchError.value = '最新の内容を取得できませんでした'
      // 届かなかったのなら、オフラインの表示に切り替える
      if (import.meta.client && isNetworkError(e)) reachable.value = false
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

  /**
   * 前回の取得から時間が経っていれば取り直す。画面を開き直したときに呼ぶ。
   *
   * 判断に使うのはブラウザの online だけにする。「届かない」と見なして
   * いる間も試しに行くことで、繋がり直したことに自力で気づける。
   */
  async function refreshIfStale(maxAgeMs = 30_000): Promise<void> {
    if (!browserOnline.value) return
    const previous = fetchedAt.value ? new Date(fetchedAt.value).getTime() : 0
    if (Date.now() - previous < maxAgeMs) return
    await fetchFromServer()
  }

  // --- 操作 -----------------------------------------------------------
  //
  // ローカルへ書いて読み直し、送信は列へ積むだけ（app/utils/offline/todo-actions.ts）。
  // オンラインかどうかで呼び分けない。

  /**
   * 一覧カードに出す本文の写しを揃える。
   *
   * 本文の正本は Section（サーバー）で、詳細画面が保存した時点で届いている。
   * ここを更新しないと、本文を書き換えて一覧へ戻っても、次の取り直しまで
   * 古い抜粋が出たままになる（docs/14-client-state.md）。
   */
  async function setBodyCopy(id: string, body: string | null): Promise<void> {
    if (!import.meta.client) return
    await setItemBody(id, body)
    await reload()
  }

  async function apply(action: () => Promise<void>): Promise<void> {
    await action()
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
    setBodyCopy,
    create: (draft: ItemDto, text: string) => apply(() => createTodo(draft, text)),
    patch: (ids: string[], values: ItemPatch) => apply(() => patchTodos(ids, values)),
    applyTags: (ids: string[], add: string[], remove: string[]) =>
      apply(() => applyTodoTags(ids, add, remove)),
    remove: (ids: string[]) => apply(() => removeTodos(ids)),
    restore: (ids: string[]) => apply(() => restoreTodos(ids)),
  }
}
