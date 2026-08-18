import type { UndoEntry } from '~/composables/useUndo'
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
import { endOfAppDay, todayDueAt } from '~~/shared/utils/date'
import { parseSmartAdd } from '~~/shared/utils/smart-add'
import { TITLE_MAX_LENGTH, splitInput } from '~~/shared/utils/text'

interface Options {
  /** 対象の status。'all' なら絞り込まない。 */
  status: MaybeRefOrGetter<ItemStatus | 'all'>
  /** 完了したものだけを見ているか（`h`）。 */
  completed?: MaybeRefOrGetter<boolean>
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
 *
 * 追加や編集は、サーバーの応答を待たずに一覧へ反映する（ローカル先行反映）。
 * 応答を待って描き直すと、押してから見た目が変わるまでの間が空く。
 * 送信は裏で行い、取り直しが済んだところで重ねるのをやめる。
 */
export function useItemList(options: Options) {
  const status = computed(() => toValue(options.status))
  const completed = computed(() => toValue(options.completed ?? false))
  const openOnly = computed(() => toValue(options.openOnly ?? false))
  const tag = computed(() => toValue(options.tag ?? undefined))
  const untagged = computed(() =>
    toValue(options.untagged ?? false) ? 'true' : undefined,
  )
  const dueUntil = computed(() =>
    toValue(options.dueUntilToday ?? false) ? 'today' : undefined,
  )
  const open = computed(() => (openOnly.value ? 'true' : undefined))
  const sort = ref<SortKey>(options.defaultSort ?? 'priority')
  const undoStack = useUndo()
  const tagList = useTags()

  const message = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)

  // --- 取得 -----------------------------------------------------------
  //
  // 未完了側と完了側の両方をあらかじめ取っておく。切り替え（`h`）のたびに
  // 取りに行くと、押してから中身が入れ替わるまで間が空く。

  const openList = useFetch<ItemDto[]>('/api/items', {
    query: { status, sort, tag, untagged, dueUntil, open },
    default: () => [],
  })

  const closedList = useFetch<ItemDto[]>('/api/items', {
    // 完了は status が closed になる。画面の status では絞り込まない
    // （status は進行状態を1つだけ持つ値なので、完了したものは
    // inbox でも backlog でもなくなる）
    query: { status: 'closed', sort, tag, untagged, dueUntil },
    default: () => [],
  })

  const server = computed<ItemDto[]>(
    () => (completed.value ? closedList.data.value : openList.data.value) ?? [],
  )

  const loading = computed(() =>
    completed.value ? closedList.pending.value : openList.pending.value,
  )

  const error = computed(() =>
    completed.value ? closedList.error.value : openList.error.value,
  )

  /** 両方を取り直す。操作で片方から片方へ移るため、まとめて更新する。 */
  async function refresh() {
    await Promise.all([openList.refresh(), closedList.refresh()])
  }

  // --- ローカル先行反映 ------------------------------------------------

  /** 送信を待たずに一覧へ重ねている変更。 */
  interface LocalChange {
    /** 対象の Item id。 */
    id: string
    /** 追加した Item。まだサーバーの一覧には無い。 */
    added?: ItemDto
    /** 変えた項目。 */
    patch?: Partial<ItemDto>
    /** 削除したか。 */
    removed?: boolean
  }

  // 操作ごとに鍵を振る。同じ Item への操作が重なっても、
  // 終わったものから順に外せるようにするため。
  const localChanges = ref(new Map<number, LocalChange>())
  let nextChangeKey = 0

  /** 変更を重ね始める。取り下げるための鍵を返す。 */
  function pushChanges(changes: LocalChange[]): number[] {
    const keys: number[] = []
    const next = new Map(localChanges.value)
    for (const change of changes) {
      const key = nextChangeKey++
      next.set(key, change)
      keys.push(key)
    }
    localChanges.value = next
    return keys
  }

  /** 重ねるのをやめる。取り直しが済んだとき、または送信に失敗したとき。 */
  function dropChanges(keys: number[]) {
    const next = new Map(localChanges.value)
    for (const key of keys) next.delete(key)
    localChanges.value = next
  }

  /**
   * いまの一覧に残るか。
   *
   * ローカルで変えた Item にだけ使う。完了にしたら未完了の一覧から
   * すぐ消える、といった見た目を応答を待たずに出すため。
   * 絞り込みの判定そのものはサーバー（server/api/items.get.ts）が正。
   */
  function belongsHere(item: ItemDto): boolean {
    if (completed.value) {
      if (item.status !== 'closed') return false
    } else {
      if (status.value !== 'all' && item.status !== status.value) return false
      if (openOnly.value && item.status === 'closed') return false
    }
    if (dueUntil.value === 'today') {
      if (!item.dueAt) return false
      if (new Date(item.dueAt) > endOfAppDay()) return false
    }
    if (tag.value && !item.tags.includes(tag.value)) return false
    if (untagged.value === 'true' && item.tags.length > 0) return false
    return true
  }

  const items = computed<ItemDto[]>(() => {
    const list = server.value
    const changes = [...localChanges.value.values()]
    if (changes.length === 0) return list

    const added = new Map<string, ItemDto>()
    const patches = new Map<string, Partial<ItemDto>>()
    const removed = new Map<string, boolean>()

    // 重ねた順に畳み込む。同じ Item を続けて操作したときは後のほうを採る
    for (const change of changes) {
      if (change.added) {
        added.set(change.id, change.added)
        removed.set(change.id, false)
      }
      if (change.patch) {
        patches.set(change.id, { ...patches.get(change.id), ...change.patch })
      }
      if (change.removed) removed.set(change.id, true)
    }

    const known = new Set(list.map((item) => item.id))
    const merged = [
      ...list,
      // 取り直しでサーバーから返ってきたものは、もう重ねる必要がない
      ...[...added.values()].filter((item) => !known.has(item.id)),
    ]

    const result: ItemDto[] = []
    for (const base of merged) {
      if (removed.get(base.id)) continue
      const patch = patches.get(base.id)
      const item = patch ? { ...base, ...patch } : base
      // 触っていないものは、サーバーの絞り込みをそのまま信じる
      if ((patch || added.has(item.id)) && !belongsHere(item)) continue
      result.push(item)
    }

    return sortItems(result, sort.value)
  })

  /**
   * 重ねた変更を、裏でサーバーへ送る。
   *
   * 送信が終わって一覧を取り直せたら、重ねるのをやめる。
   * 失敗したら重ねた変更を取り消し、見た目を元へ戻す。
   */
  function sync(
    keys: number[],
    send: () => Promise<unknown>,
    settings: { undo?: UndoEntry; tags?: boolean } = {},
  ): Promise<void> {
    // 前の失敗を引きずらない。送信そのものは列に並ぶが、
    // 操作を始めた時点で消しておく
    errorMessage.value = null

    return enqueue(async () => {
      try {
        await send()
      } catch (e) {
        errorMessage.value = extractMessage(e)
        // 何もできていないので、済んだかのような文言は残さない
        message.value = null
        dropChanges(keys)
        // 戻す先がもう無いので、取り消しの候補からも外す
        if (settings.undo) undoStack.remove(settings.undo)
        return
      }
      await Promise.all([
        refresh(),
        ...(settings.tags ? [tagList.refresh()] : []),
      ])
      dropChanges(keys)
    })
  }

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
   * 元の値へ戻す取り消し操作。
   *
   * 元の値は Item ごとに異なるため、まとめて戻さず1件ずつ復元する。
   * 戻す側もローカルへ先に反映し、送信は裏で行う。
   */
  function restoreEntry(
    label: string,
    before: { id: string; values: ItemPatch }[],
  ): UndoEntry {
    return {
      label,
      revert: async () => {
        const keys = pushChanges(
          before.map((snapshot) => ({
            id: snapshot.id,
            patch: snapshot.values,
          })),
        )
        void sync(keys, async () => {
          for (const snapshot of before) {
            await $fetch(itemPath(snapshot.id), {
              method: 'PATCH',
              body: snapshot.values,
            })
          }
        })
      },
    }
  }

  /** 対象に patch を適用し、元に戻す処理を Undo スタックへ積む。 */
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

    const changeKeys = pushChanges(
      list.map((item) => ({ id: item.id, patch })),
    )
    message.value = describe(list.length, label)
    clearSelection()

    const entry = restoreEntry(label, before)
    undoStack.push(entry)

    void sync(
      changeKeys,
      async () => {
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
      },
      { undo: entry },
    )
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
    const after = list.map((item) => ({
      id: item.id,
      values: {
        dueAt: postponedDue(item).toISOString(),
        dueHasTime: item.dueHasTime,
      } as ItemPatch,
    }))

    const changeKeys = pushChanges(
      after.map((next) => ({ id: next.id, patch: next.values })),
    )
    message.value = describe(list.length, '期限を明日にした')
    clearSelection()

    const entry = restoreEntry('期限を明日にした', before)
    undoStack.push(entry)

    void sync(
      changeKeys,
      async () => {
        for (const next of after) {
          await $fetch(itemPath(next.id), {
            method: 'PATCH',
            body: next.values,
          })
        }
      },
      { undo: entry },
    )
  }

  /** 削除。スナップショットを保持し、Undo で復元できるようにする。 */
  async function remove() {
    const list = targets.value
    if (list.length === 0) return

    const changeKeys = pushChanges(
      list.map((item) => ({ id: item.id, removed: true })),
    )
    message.value = describe(list.length, '削除した')
    clearSelection()

    // 復元に要る内容は DELETE の応答で返ってくる。送信は投げた順に
    // 処理されるため、取り消しが走るころには埋まっている。
    const snapshots: ItemDetailDto[] = []

    const entry: UndoEntry = {
      label: '削除した',
      revert: async () => {
        const restoreKeys = pushChanges(
          list.map((item) => ({ id: item.id, added: item })),
        )
        void sync(
          restoreKeys,
          async () => {
            for (const snapshot of snapshots) {
              await $fetch<ItemDto>('/api/items/restore', {
                method: 'POST',
                body: snapshot,
              })
            }
          },
          { tags: true },
        )
      },
    }
    undoStack.push(entry)

    // 削除で参照が0になったタグは消えるため、タグ一覧も取り直す
    void sync(
      changeKeys,
      async () => {
        for (const item of list) {
          snapshots.push(
            await $fetch<ItemDetailDto>(itemPath(item.id), { method: 'DELETE' }),
          )
        }
      },
      { undo: entry, tags: true },
    )
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

    const after = list.map((item) => ({
      id: item.id,
      tags: nextTags(item.tags, add, remove),
    }))

    const changeKeys = pushChanges(
      after.map((next) => ({ id: next.id, patch: { tags: next.tags } })),
    )
    message.value = describe(list.length, 'タグを変更した')
    clearSelection()

    let entry: UndoEntry | undefined
    if (addedNow.length > 0 || removedNow.length > 0) {
      entry = {
        label: 'タグを変更した',
        revert: async () => {
          const revertKeys = pushChanges(
            after.map((next) => ({
              id: next.id,
              patch: { tags: nextTags(next.tags, removedNow, addedNow) },
            })),
          )
          void sync(
            revertKeys,
            () =>
              $fetch<ItemDto[]>('/api/items/tags', {
                method: 'POST',
                body: { ids, add: removedNow, remove: addedNow },
              }),
            { tags: true },
          )
        },
      }
      undoStack.push(entry)
    }

    void sync(
      changeKeys,
      () =>
        $fetch<ItemDto[]>('/api/items/tags', {
          method: 'POST',
          body: { ids, add, remove },
        }),
      { undo: entry, tags: true },
    )
  }

  async function undo() {
    const label = await undoStack.undo()
    message.value = label ? `「${label}」を取り消した` : '取り消せる操作がありません'
  }

  /**
   * Item を追加する。
   *
   * 応答を待たずに一覧へ出す。サーバーと同じパーサ（SmartAdd）と同じ既定値
   * （期限は今日）を使うため、あとから届く内容と食い違わない。
   * id もここで決めて送る。決まっていないと、追加直後の操作の宛先がない。
   */
  async function create(text: string): Promise<boolean> {
    const split = splitInput(text)
    const parsed = split ? parseSmartAdd(split.titleLine) : null

    if (!split || !parsed?.title) {
      errorMessage.value = 'タイトルが空です'
      return false
    }
    if (parsed.title.length > TITLE_MAX_LENGTH) {
      errorMessage.value = `タイトルは ${TITLE_MAX_LENGTH} 文字までです`
      return false
    }

    const now = new Date()
    const draft: ItemDto = {
      id: crypto.randomUUID(),
      title: parsed.title,
      status: 'inbox',
      priority: parsed.priority,
      url: parsed.url,
      // 期限の指定がなければ今日（server/api/items.post.ts と同じ既定）
      dueAt: (parsed.dueAt ?? todayDueAt(now)).toISOString(),
      dueHasTime: parsed.dueAt ? parsed.dueHasTime : false,
      body: split.body ?? null,
      tags: [...parsed.tags].sort(),
      recurrenceRule: parsed.recurrence?.rule ?? null,
      recurrenceBasis: parsed.recurrence?.basis ?? null,
      seriesId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    errorMessage.value = null
    const changeKeys = pushChanges([{ id: draft.id, added: draft }])

    void sync(
      changeKeys,
      () =>
        $fetch<ItemDto>('/api/items', {
          method: 'POST',
          body: { id: draft.id, text },
        }),
      { tags: true },
    )

    return true
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

/** タグの付け外しを反映した名前の並び。サーバーと同じく名前順にそろえる。 */
function nextTags(current: string[], add: string[], remove: string[]): string[] {
  const next = new Set(current.filter((name) => !remove.includes(name)))
  for (const name of add) next.add(name)
  return [...next].sort()
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
