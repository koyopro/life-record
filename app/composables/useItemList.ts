import type { UndoEntry } from '~/composables/useUndo'
import type { LocalItem } from '~/utils/offline/local-database'
import {
  isGroupKey,
  STATUS_LABELS,
  type GroupKey,
  type ItemDto,
  type ItemPatch,
  type ItemStatus,
  type Priority,
  type SortKey,
  toSortKey,
} from '~~/shared/types/item'
import { groupSettingKey, sortSettingKey } from '~~/shared/types/setting'
import type { DueCondition, ListView } from '~~/shared/types/smart-list'
import { matchesDue } from '~~/shared/utils/smart-list'
import type { Recurrence } from '~~/shared/types/recurrence'
import { writeToClipboard } from '~/utils/clipboard'
import { composeItemCopyText } from '~/utils/item-copy'
import { buildItemDraft } from '~/utils/item-draft'
import { groupItems, nextFocusAfterRemoval } from '~/utils/item-order'
import { endOfAppDay, startOfAppDay } from '~~/shared/utils/date'

/**
 * 一覧に出す Item を、絞り込みではなく**外から**与える（検索結果）。
 *
 * 検索の当たり外れを決めるのはサーバーで、手元の条件では作れない。
 * 代わりに id の並びを渡し、手元の Item（＝一覧と同じ元）から引き当てる。
 * こうすると、出す中身だけが違って**操作は一覧とまったく同じ**になる。
 */
interface ExternalItems {
  /** 出す Item の id。渡した順に並べる（並び・グループ順は使わない）。 */
  ids: MaybeRefOrGetter<string[]>
  /**
   * カーソルが指しているタスク。
   *
   * 検索結果にはタスク以外の行（日記）も混ざるので、カーソルは行の側が
   * 持つ（`useListCursor`）。ここへはタスクを指している間だけ id が渡り、
   * それ以外は null になって操作の対象が空になる。指していない行に
   * 対して `c` や `Delete` が効いてしまうことがない。
   */
  focusedId: MaybeRefOrGetter<string | null>
}

interface Options {
  /** 対象の status。'all' なら絞り込まない。 */
  status: MaybeRefOrGetter<ItemStatus | 'all'>
  /** 出す Item を外から与える（検索結果）。渡すと絞り込み・並びは使わない。 */
  external?: ExternalItems
  /**
   * 表示方法（`open` / `completed` / `all`）。
   *
   * `all` は**状態を見ない**（スマートリスト、docs/08-todo-management.md 8.6）。
   */
  view?: MaybeRefOrGetter<ListView>
  /** 絞り込むタグ名。undefined なら絞り込まない。 */
  tag?: MaybeRefOrGetter<string | undefined>
  /** タグが付いていない Item だけに絞るか。 */
  untagged?: MaybeRefOrGetter<boolean>
  /** 期限での絞り込み（スマートリスト）。タグとは AND で重ねる。 */
  due?: MaybeRefOrGetter<DueCondition | null>
  /** 期限が今日までのものだけに絞るか（「今日」リスト）。 */
  dueUntilToday?: MaybeRefOrGetter<boolean>
  /**
   * どの一覧か（`items` / `today`）。並び・グループ順は画面ごとに覚えるので、
   * その鍵に使う（`sortSettingKey`）。外から与えるとき（スマートリスト）は
   * 覚え先がそちらになるので、渡さない。
   */
  screen?: string
  defaultSort?: SortKey
  /**
   * 並び・グループ順を外から与える（スマートリスト）。
   *
   * 与えたときの覚え先はリストの定義なので、選び直したことは
   * `onSortChange` / `onGroupChange` で呼び出し側へ返す。
   */
  sort?: MaybeRefOrGetter<SortKey>
  groupBy?: MaybeRefOrGetter<GroupKey>
  onSortChange?: (value: SortKey) => void
  onGroupChange?: (value: GroupKey) => void
}

/** `useItemList` が返すもの。共通の操作部品（`ItemActions`）へ渡す。 */
export type ItemList = ReturnType<typeof useItemList>

/**
 * 一覧の絞り込み・カーソル・複数選択・編集操作をまとめたもの。
 *
 * キーボード操作（docs/08-todo-management.md 8.4）は「選択中のタスク」に
 * 対して働くため、カーソルと選択の状態をデータと同じ場所で持つ。
 *
 * データそのものは持たない。全件は useItemStore（＝IndexedDB）にあり、
 * ここはそこから今の一覧に出すものを選んで並べるだけ。
 * 絞り込みをローカルで計算しているので、オフラインでも同じ一覧が出る
 * （docs/12-offline.md 12.4）。
 *
 * 追加や編集は、サーバーの応答を待たずに反映する（ローカル先行反映）。
 * 送信は useSync が裏で順に行うため、ここでは待たない。
 */
export function useItemList(options: Options) {
  const status = computed(() => toValue(options.status))
  const view = computed<ListView>(() => toValue(options.view ?? 'open'))
  const tag = computed(() => toValue(options.tag ?? undefined))
  const untagged = computed(() => toValue(options.untagged ?? false))
  const due = computed(() => toValue(options.due ?? null))
  const dueUntilToday = computed(() => toValue(options.dueUntilToday ?? false))
  /*
   * 並び・グループ順。外から与えられていればそちらを読み書きし、
   * 無ければこの場で持つ（＝画面ごとに覚える）。
   */
  const ownSort = ref<SortKey>(options.defaultSort ?? 'priorityDueDesc')
  const ownGroupBy = ref<GroupKey>('none')

  const sort = computed<SortKey>({
    get: () => (options.sort === undefined ? ownSort.value : toValue(options.sort)),
    set: (value) => {
      if (options.sort === undefined) ownSort.value = value
      else options.onSortChange?.(value)
    },
  })

  const groupBy = computed<GroupKey>({
    get: () =>
      options.groupBy === undefined ? ownGroupBy.value : toValue(options.groupBy),
    set: (value) => {
      if (options.groupBy === undefined) ownGroupBy.value = value
      else options.onGroupChange?.(value)
    },
  })

  const store = useItemStore()
  const sync = useSync()
  const undoStack = useUndo()
  const tagList = useTags()

  const message = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)

  /**
   * しばらくしたら消える知らせ。
   *
   * 操作の結果（「完了にした」など）は次の操作まで残しておきたいが、
   * 「コピーした」のように済んだことだけを伝えるものは、残しても
   * 選択中の件数の隣で場所を取るだけになる。
   */
  const TRANSIENT_MESSAGE_MS = 2500
  let transientTimer: ReturnType<typeof setTimeout> | undefined

  function showTransientMessage(text: string) {
    message.value = text
    clearTimeout(transientTimer)
    transientTimer = setTimeout(() => {
      // 別の知らせに変わっていたら、それを消さない
      if (message.value === text) message.value = null
    }, TRANSIENT_MESSAGE_MS)
  }

  // --- 一覧 -----------------------------------------------------------
  //
  // 未完了側と完了側で取りに行き分けることはしない。全件がローカルにあるので、
  // 切り替え（`h`）は絞り込みを変えるだけで済む。

  /**
   * いまの一覧に出すか。
   *
   * サーバーの絞り込み（server/api/items.get.ts）と同じ条件をここで作る。
   * ずれていると、取り直したときに行が現れたり消えたりする。
   */
  function belongsHere(item: LocalItem): boolean {
    // 削除して、まだ送れていないもの。取り消せるよう記録は残してある
    if (item.syncState === 'pending_delete') return false

    if (view.value === 'completed') {
      if (item.status !== 'closed') return false
      // 「今日」リストの完了タスクは、期限ではなく「今日完了したか」で絞る。
      // 未完了側は「今日までにやること」を期限で選ぶのに対し、完了側で
      // 知りたいのは「今日終えたこと」であり、対応する軸が違うため。
      if (dueUntilToday.value) {
        if (!item.completedAt) return false
        const completedAt = new Date(item.completedAt)
        if (completedAt < startOfAppDay() || completedAt > endOfAppDay()) return false
      }
    } else {
      // 未完了側に完了したものは出さない。「未完了 / 完了」は裏表で、
      // 見ている側に反対のものが混じると切り替えの意味が無くなる
      // （docs/08-todo-management.md 8.4）。
      // 「すべて」は裏表を持たない見方なので、状態では絞らない。
      if (view.value === 'open' && item.status === 'closed') return false
      if (status.value !== 'all' && item.status !== status.value) return false
      if (dueUntilToday.value) {
        if (!item.dueAt) return false
        if (new Date(item.dueAt) > endOfAppDay()) return false
      }
    }
    if (tag.value && !item.tags.includes(tag.value)) return false
    if (untagged.value && item.tags.length > 0) return false
    // 期限の条件はタグと AND で重ねる（docs/08-todo-management.md 8.6）
    if (!matchesDue(item.dueAt, due.value)) return false
    return true
  }

  /**
   * カーソル（`j` `k`）は、この並びを1本の列として上から下へ動く。
   *
   * グループ表示中は、見出しをまたいでも表示順のまま連続して動けるよう、
   * グループごとにまとめた順序をそのまま基準にする（見た目の並びと
   * カーソルの移動順を一致させるため）。グループ内の順序は並びのまま。
   */
  const items = computed<LocalItem[]>(() => {
    // 外から与えられていれば、その並びのまま出す（検索結果）
    if (options.external) {
      const byId = new Map(store.items.value.map((item) => [item.id, item]))
      const found: LocalItem[] = []
      for (const id of toValue(options.external.ids)) {
        const item = byId.get(id)
        // 消して、まだ送れていないものは一覧に出さない（belongsHere と同じ）
        if (item && item.syncState !== 'pending_delete') found.push(item)
      }
      return found
    }

    const sorted = sortItems(store.items.value.filter(belongsHere), sort.value)
    if (groupBy.value === 'none') return sorted
    return groupItems(sorted, groupBy.value).flatMap((group) =>
      group.items.map(({ item }) => item),
    )
  })

  const loading = store.loading

  /** 読み込めなかった。ローカルに何か出せるなら、わざわざ出さない。 */
  const error = computed(() =>
    store.items.value.length === 0 ? store.fetchError.value : null,
  )

  /** サーバーから取り直す。 */
  async function refresh() {
    await store.fetchFromServer()
  }

  // 画面を開いたら最新を見に行く。ローカルの表示は待たせない
  onMounted(() => {
    void store.refreshIfStale()
  })

  // 送信が通ったらタグ一覧を取り直す。タグは Item 側の操作で増減する
  watch(sync.lastSyncedAt, () => {
    void tagList.refresh()
  })

  // --- カーソルと選択 -------------------------------------------------

  /*
   * カーソル（`j` `k`）の持ち方・送り方は、検索結果と同じものを使う
   * （app/composables/useListCursor.ts）。
   *
   * 編集した結果その一覧の条件から外れる（完了にする・タグを外す・期限を
   * 動かす）ことは多く、そのたびに先頭へ飛ばされると続けて片付けられない。
   * **消える前にその下にあったもの**へ移す（`nextFocusAfterRemoval`）。
   */
  const own = useListCursor(items, { onMissing: nextFocusAfterRemoval })
  const { cursor, moveCursor, focusRow: focusItem, listEl } = own

  /**
   * カーソルが指している Item。
   *
   * 外から与えられているとき（検索結果）は、カーソルもそちらが持つ。
   * タスク以外の行を指している間は null になり、操作の対象が空になる。
   */
  const cursorItem = computed<LocalItem | null>(() => {
    if (!options.external) return own.cursorRow.value
    const id = toValue(options.external.focusedId)
    return (id && items.value.find((item) => item.id === id)) || null
  })

  const selectedIds = ref<Set<string>>(new Set())

  /** 操作の対象。複数選択があればそちら、なければカーソル位置。 */
  const targets = computed<LocalItem[]>(() => {
    if (selectedIds.value.size > 0) {
      return items.value.filter((item) => selectedIds.value.has(item.id))
    }
    return cursorItem.value ? [cursorItem.value] : []
  })

  // 一覧から消えたものは選択からも外す
  watch(items, (list) => {
    const alive = new Set(list.map((item) => item.id))
    const next = new Set([...selectedIds.value].filter((id) => alive.has(id)))
    if (next.size !== selectedIds.value.size) selectedIds.value = next
  })

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

  /** 表示中のものをすべて選ぶ（`*` `a`、RTM の Select All）。 */
  function selectAll() {
    selectedIds.value = new Set(items.value.map((item) => item.id))
  }

  /**
   * 期限が指定の状態のものだけを選ぶ（`*` `t` / `o` / `v`、RTM の
   * Select by due date）。表示中の一覧（絞り込み後）から選ぶ。
   */
  function selectByDue(state: 'today' | 'tomorrow' | 'overdue') {
    selectedIds.value = new Set(
      items.value
        .filter((item) => formatDue(item).state === state)
        .map((item) => item.id),
    )
  }

  // --- 編集操作 -------------------------------------------------------

  function describe(count: number, action: string): string {
    return count === 1 ? action : `${count}件を${action}`
  }

  /**
   * 元の値へ戻す取り消し操作。
   *
   * 元の値は Item ごとに異なるため、まとめて戻さず1件ずつ復元する。
   * 戻す側もローカルへ先に反映し、送信は列へ積むだけ。
   */
  function restoreEntry(
    label: string,
    before: { id: string; values: ItemPatch }[],
  ): UndoEntry {
    return {
      label,
      revert: async () => {
        for (const snapshot of before) {
          await store.patch([snapshot.id], snapshot.values)
        }
      },
    }
  }

  /** 対象に patch を適用し、元に戻す処理を Undo スタックへ積む。 */
  async function applyPatch(
    patch: ItemPatch,
    label: string,
    scope?: LocalItem[],
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

    errorMessage.value = null
    message.value = describe(list.length, label)
    // 選択はそのまま残す。続けて別の操作を同じ対象へ重ねられるようにするため
    // （一覧から外れた分は、items の watch が選択からも自動で外す）

    undoStack.push(restoreEntry(label, before))

    await store.patch(
      list.map((item) => item.id),
      patch,
    )
  }

  async function complete() {
    await applyPatch({ status: 'closed' }, '完了にした')
  }

  async function setStatus(status: ItemStatus) {
    await applyPatch({ status }, `${STATUS_LABELS[status]}にした`)
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

    message.value = describe(list.length, '期限を明日にした')
    // 選択はそのまま残す（applyPatch と同じ理由）
    undoStack.push(restoreEntry('期限を明日にした', before))

    for (const item of list) {
      await store.patch([item.id], {
        dueAt: postponedDue(item).toISOString(),
        dueHasTime: item.dueHasTime,
      })
    }
  }

  /**
   * 削除。取り消し（`u`）で元に戻せるようにする。
   *
   * まだ送っていなければ送らずに取り消す。すでに送ってしまっていた場合は、
   * 削除の応答として受け取った控えから復元する（useItemStore の restore）。
   */
  async function remove() {
    const list = targets.value
    if (list.length === 0) return

    const ids = list.map((item) => item.id)
    message.value = describe(list.length, '削除した')
    clearSelection()

    undoStack.push({
      label: '削除した',
      revert: async () => {
        await store.restore(ids)
      },
    })

    await store.remove(ids)
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

    message.value = describe(list.length, 'タグを変更した')
    // 選択はそのまま残す（applyPatch と同じ理由）

    if (addedNow.length > 0 || removedNow.length > 0) {
      undoStack.push({
        label: 'タグを変更した',
        revert: async () => {
          await store.applyTags(ids, removedNow, addedNow)
        },
      })
    }

    await store.applyTags(ids, add, remove)
  }

  async function undo() {
    const label = await undoStack.undo()
    message.value = label ? `「${label}」を取り消した` : '取り消せる操作がありません'
  }

  /**
   * 対象をクリップボードへ写す（`⌘ + C`）。
   *
   * 本文はローカルの写し（`ItemDto.body`）から取るので、詳細を開いていなくても
   * 一覧から直接コピーできる。中身の作りは composeItemCopyText に任せる
   * （詳細画面と同じ形にするため）。
   */
  async function copy() {
    const list = targets.value
    if (list.length === 0) return

    errorMessage.value = null
    // 打鍵の流れのまま書き込む。間に待ちを挟むとブラウザに拒まれる
    const written = await writeToClipboard(composeItemCopyText(list))

    if (!written) {
      errorMessage.value = 'コピーできませんでした'
      return
    }

    showTransientMessage(describe(list.length, 'コピーした'))
  }

  /**
   * Item を追加する。
   *
   * 応答を待たずに一覧へ出す。組み立ては buildItemDraft に任せる
   * （共有の受付と同じ経路を通す）。
   */
  async function create(text: string): Promise<boolean> {
    const result = buildItemDraft(text)

    if ('error' in result) {
      errorMessage.value = result.error
      return false
    }

    errorMessage.value = null
    await store.create(result.draft, text)

    return true
  }

  // --- ソート・グループ順 -----------------------------------------------
  //
  // グループ順は並びより上位の区切り（RTM の Group by）。同じ画面を
  // また開いたときも同じ見え方になるよう、並びと同じく覚えておく。
  //
  // 覚える先はサーバー（docs/15-client-state.md 14.7）。ブラウザに閉じて
  // いると、PC と iPhone、あるいはブラウザを変えるたびに見え方が変わる。

  const screen = options.screen
  if (screen) {
    const settings = useSettings()
    const sortKey = sortSettingKey(screen)
    const groupKey = groupSettingKey(screen)

    // 無くした軸（タイトル順など）を覚えていることもあるので、読み替えて拾う
    settings.track(sortKey, (value) => {
      const key = toSortKey(value)
      if (key) ownSort.value = key
    })

    settings.track(groupKey, (value) => {
      if (isGroupKey(value)) ownGroupBy.value = value
    })

    watch(ownSort, (value) => settings.set(sortKey, value))
    watch(ownGroupBy, (value) => settings.set(groupKey, value))
  }

  return {
    items,
    loading,
    error,
    message,
    errorMessage,
    sort,
    groupBy,
    cursor,
    cursorItem,
    /** 行を並べている入れ物。カーソルを画面内へ送るのに使う（`ref="listEl"`）。 */
    listEl,
    selectedIds,
    targets,
    canUndo: undoStack.canUndo,
    moveCursor,
    focusItem,
    toggleSelect,
    clearSelection,
    selectAll,
    selectByDue,
    complete,
    setStatus,
    setPriority,
    setDue,
    setRecurrence,
    postpone,
    remove,
    applyTags,
    undo,
    copy,
    create,
    refresh,
  }
}
