import {
  isSortKey,
  type ItemDetailDto,
  type ItemDto,
  type ItemPatch,
  type ItemStatus,
  type Priority,
  type SortKey,
} from '~~/shared/types/item'
import type { Recurrence } from '~~/shared/types/recurrence'

interface Options {
  /** 対象の status。'all' なら絞り込まない。 */
  status: MaybeRefOrGetter<ItemStatus | 'all'>
  /** 絞り込むタグ名。undefined なら絞り込まない。 */
  tag?: MaybeRefOrGetter<string | undefined>
  /** タグが付いていない Item だけに絞るか。 */
  untagged?: MaybeRefOrGetter<boolean>
  /** 期限が今日までのものだけに絞るか（「今日」リスト）。 */
  dueUntilToday?: MaybeRefOrGetter<boolean>
  /** 未完了のものだけに絞るか。 */
  openOnly?: MaybeRefOrGetter<boolean>
  /** ソート軸を localStorage に覚えるためのキー。画面ごとに分ける。 */
  sortStorageKey: string
  defaultSort?: SortKey
}

/**
 * 一覧の取得・カーソル・複数選択・編集操作をまとめたもの。
 *
 * キーボード操作（docs/08-todo-management.md 8.4）は「選択中のタスク」に
 * 対して働くため、カーソルと選択の状態をデータと同じ場所で持つ。
 */
export function useItemList(options: Options) {
  const status = computed(() => toValue(options.status))
  const tag = computed(() => toValue(options.tag ?? undefined))
  const untagged = computed(() =>
    toValue(options.untagged ?? false) ? 'true' : undefined,
  )
  const dueUntil = computed(() =>
    toValue(options.dueUntilToday ?? false) ? 'today' : undefined,
  )
  const open = computed(() =>
    toValue(options.openOnly ?? false) ? 'true' : undefined,
  )
  const sort = ref<SortKey>(options.defaultSort ?? 'priority')
  const undoStack = useUndo()
  const tagList = useTags()

  const message = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)

  const {
    data,
    pending: loading,
    error,
    refresh,
  } = useFetch<ItemDto[]>('/api/items', {
    query: { status, sort, tag, untagged, dueUntil, open },
    default: () => [],
  })

  const items = computed(() => data.value ?? [])

  // --- カーソルと選択 -------------------------------------------------

  /**
   * カーソルが指している Item の id。
   *
   * 位置（index）ではなく id で持つ。重要度を変えるなどして並び順が
   * 変わったとき、位置で持っていると同じ位置が別の Item を指してしまう。
   */
  const focusedId = ref<string | null>(null)
  const selectedIds = ref<Set<string>>(new Set())

  /** 表示上のカーソル位置。focusedId から導く。 */
  const cursor = computed(() => {
    const index = items.value.findIndex((item) => item.id === focusedId.value)
    return index >= 0 ? index : 0
  })

  const cursorItem = computed<ItemDto | null>(
    () => items.value[cursor.value] ?? null,
  )

  /** 操作の対象。複数選択があればそちら、なければカーソル位置。 */
  const targets = computed<ItemDto[]>(() => {
    if (selectedIds.value.size > 0) {
      return items.value.filter((item) => selectedIds.value.has(item.id))
    }
    return cursorItem.value ? [cursorItem.value] : []
  })

  watch(
    items,
    (list) => {
      // 指していた Item が一覧から消えたら、同じ位置にあるものへ移す
      const stillThere = list.some((item) => item.id === focusedId.value)
      if (!stillThere) {
        const fallback = Math.min(cursor.value, Math.max(0, list.length - 1))
        focusedId.value = list[fallback]?.id ?? null
      }

      // 一覧から消えたものは選択からも外す
      const alive = new Set(list.map((item) => item.id))
      const next = new Set([...selectedIds.value].filter((id) => alive.has(id)))
      if (next.size !== selectedIds.value.size) selectedIds.value = next
    },
    { immediate: true },
  )

  function moveCursor(delta: number) {
    const list = items.value
    if (list.length === 0) return
    const next = Math.min(Math.max(cursor.value + delta, 0), list.length - 1)
    focusedId.value = list[next]?.id ?? null
  }

  function focusItem(id: string) {
    if (items.value.some((item) => item.id === id)) focusedId.value = id
  }

  function toggleSelect(id?: string) {
    const targetId = id ?? cursorItem.value?.id
    if (!targetId) return
    const next = new Set(selectedIds.value)
    if (next.has(targetId)) next.delete(targetId)
    else next.add(targetId)
    selectedIds.value = next
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  // --- 編集操作 -------------------------------------------------------

  function describe(count: number, action: string): string {
    return count === 1 ? action : `${count}件を${action}`
  }

  /**
   * 対象に patch を適用し、元に戻す処理を Undo スタックへ積む。
   *
   * 元の値は Item ごとに異なるため、まとめて戻さず1件ずつ復元する。
   */
  async function applyPatch(
    patch: ItemPatch,
    label: string,
    scope?: ItemDto[],
  ) {
    const list = scope ?? targets.value
    if (list.length === 0) return

    const keys = Object.keys(patch) as (keyof ItemPatch)[]
    const before = list.map((item) => ({
      id: item.id,
      values: Object.fromEntries(
        keys.map((key) => [key, item[key as keyof ItemDto]]),
      ) as ItemPatch,
    }))

    try {
      await request(async () => {
        // 1件なら単体エンドポイント、複数なら一括エンドポイント。
        // 三項演算子でまとめると型推論が破綻するので分岐を分ける。
        const single = list.length === 1 ? list[0] : undefined
        if (single) {
          await $fetch(itemPath(single.id), { method: 'PATCH', body: patch })
          return
        }
        await $fetch<ItemDto[]>('/api/items', {
          method: 'PATCH',
          body: { ids: list.map((item) => item.id), patch },
        })
      })
    } catch {
      return
    }

    undoStack.push({
      label,
      revert: async () => {
        for (const snapshot of before) {
          await $fetch(itemPath(snapshot.id), {
            method: 'PATCH',
            body: snapshot.values,
          })
        }
        await refresh()
      },
    })

    message.value = describe(list.length, label)
    clearSelection()
    await refresh()
  }

  async function complete() {
    await applyPatch({ status: 'closed' }, '完了にした')
  }

  async function setStatus(status: ItemStatus) {
    await applyPatch({ status }, `${STATUS_LABELS_JA[status]}にした`)
  }

  async function setPriority(priority: Priority | null) {
    const label = priority ? `重要度を${priority}にした` : '重要度を外した'
    await applyPatch({ priority }, label)
  }

  async function setRecurrence(recurrence: Recurrence | null) {
    await applyPatch(
      {
        recurrenceRule: recurrence?.rule ?? null,
        recurrenceBasis: recurrence?.basis ?? null,
      },
      recurrence ? '繰り返しを設定した' : '繰り返しをやめた',
    )
  }

  async function setDue(dueAt: Date | null, hasTime = false) {
    await applyPatch(
      { dueAt: dueAt?.toISOString() ?? null, dueHasTime: hasTime },
      dueAt ? '期限を設定した' : '期限を外した',
    )
  }

  /** 期限を明日にする（`p`）。時刻の扱いが Item ごとに違うので個別に計算する。 */
  async function postpone() {
    const list = targets.value
    if (list.length === 0) return

    const before = list.map((item) => ({
      id: item.id,
      values: { dueAt: item.dueAt, dueHasTime: item.dueHasTime } as ItemPatch,
    }))

    try {
      await request(async () => {
        for (const item of list) {
          await $fetch(itemPath(item.id), {
            method: 'PATCH',
            body: {
              dueAt: postponedDue(item).toISOString(),
              dueHasTime: item.dueHasTime,
            },
          })
        }
      })
    } catch {
      return
    }

    undoStack.push({
      label: '期限を明日にした',
      revert: async () => {
        for (const snapshot of before) {
          await $fetch(itemPath(snapshot.id), {
            method: 'PATCH',
            body: snapshot.values,
          })
        }
        await refresh()
      },
    })

    message.value = describe(list.length, '期限を明日にした')
    clearSelection()
    await refresh()
  }

  /** 削除。スナップショットを保持し、Undo で復元できるようにする。 */
  async function remove() {
    const list = targets.value
    if (list.length === 0) return

    const snapshots: ItemDetailDto[] = []
    try {
      await request(async () => {
        for (const item of list) {
          snapshots.push(
            await $fetch<ItemDetailDto>(itemPath(item.id), {
              method: 'DELETE',
            }),
          )
        }
      })
    } catch {
      return
    }

    undoStack.push({
      label: '削除した',
      revert: async () => {
        for (const snapshot of snapshots) {
          await $fetch<ItemDto>('/api/items/restore', {
            method: 'POST',
            body: snapshot,
          })
        }
        await refresh()
      },
    })

    message.value = describe(list.length, '削除した')
    clearSelection()
    // 削除で参照が0になったタグは消えるため、一覧を取り直す
    await Promise.all([refresh(), tagList.refresh()])
  }

  /**
   * 対象のタグを付け外しする。
   *
   * Undo では逆向きの付け外しを行う。タグは他の Item と共有されるため、
   * 一括で元に戻すのではなく、変更内容の反転で戻す。
   */
  async function applyTags(add: string[], remove: string[]) {
    const list = targets.value
    if (list.length === 0) return
    if (add.length === 0 && remove.length === 0) return

    // すでに付いていた / 付いていなかったものは戻す対象から外す。
    // 他の操作で付いたタグを Undo で誤って剥がさないようにするため。
    const addedNow = add.filter((name) =>
      list.some((item) => !item.tags.includes(name)),
    )
    const removedNow = remove.filter((name) =>
      list.some((item) => item.tags.includes(name)),
    )
    const ids = list.map((item) => item.id)

    try {
      await request(() =>
        $fetch<ItemDto[]>('/api/items/tags', {
          method: 'POST',
          body: { ids, add, remove },
        }),
      )
    } catch {
      return
    }

    if (addedNow.length > 0 || removedNow.length > 0) {
      undoStack.push({
        label: 'タグを変更した',
        revert: async () => {
          await $fetch<ItemDto[]>('/api/items/tags', {
            method: 'POST',
            body: { ids, add: removedNow, remove: addedNow },
          })
          await Promise.all([refresh(), tagList.refresh()])
        },
      })
    }

    message.value = describe(list.length, 'タグを変更した')
    clearSelection()
    await Promise.all([refresh(), tagList.refresh()])
  }

  async function undo() {
    const label = await undoStack.undo()
    message.value = label ? `「${label}」を取り消した` : '取り消せる操作がありません'
  }

  async function create(text: string): Promise<boolean> {
    try {
      await request(() =>
        $fetch<ItemDto>('/api/items', { method: 'POST', body: { text } }),
      )
    } catch {
      return false
    }
    await Promise.all([refresh(), tagList.refresh()])
    return true
  }

  /** 通信エラーを画面に出せる形にそろえる。 */
  async function request(fn: () => Promise<unknown>): Promise<void> {
    errorMessage.value = null
    try {
      await fn()
    } catch (e) {
      errorMessage.value = extractMessage(e)
      throw e
    }
  }

  // --- ソート ---------------------------------------------------------

  onMounted(() => {
    const stored = localStorage.getItem(options.sortStorageKey)
    if (isSortKey(stored)) sort.value = stored
  })

  watch(sort, (value) => {
    if (import.meta.client) localStorage.setItem(options.sortStorageKey, value)
  })

  return {
    items,
    loading,
    error,
    message,
    errorMessage,
    sort,
    cursor,
    cursorItem,
    selectedIds,
    targets,
    canUndo: undoStack.canUndo,
    moveCursor,
    focusItem,
    toggleSelect,
    clearSelection,
    complete,
    setStatus,
    setPriority,
    setDue,
    setRecurrence,
    postpone,
    remove,
    applyTags,
    undo,
    create,
    refresh,
  }
}

/**
 * URL を string 型として組み立てるための薄いラッパー。
 *
 * テンプレートリテラルをそのまま $fetch に渡すと、Nitro の型付きルート推論が
 * 全ルートを突き合わせようとして型チェックが破綻する。
 */
function itemPath(id: string): string {
  return `/api/items/${id}`
}

const STATUS_LABELS_JA: Record<ItemStatus, string> = {
  inbox: 'Inbox',
  backlog: 'Backlog',
  in_progress: '対応中',
  closed: '完了',
}

function extractMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    // サーバーは message で返す。statusMessage は HTTP ステータス行に載るため
    // 日本語が壊れる（h3 も将来サニタイズすると警告している）。
    const data = (e as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  return '操作に失敗しました'
}
