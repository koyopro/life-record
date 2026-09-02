import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type GroupKey,
  type ItemDto,
  type ItemStatus,
  type Priority,
  type SortKey,
} from '~~/shared/types/item'

/**
 * 一覧の並び（docs/08-todo-management.md 8.2）。
 *
 * サーバーの ORDER BY（server/utils/items.ts の `orderByFor`）と同じ順序を
 * クライアントでも作る。追加や重要度の変更を応答を待たずに反映するとき、
 * 正しい位置へ置くために要る。ここがずれていると、取り直しのたびに行が飛ぶ。
 */
export function sortItems<T extends ItemDto>(items: T[], sort: SortKey): T[] {
  return [...items].sort(comparatorFor(sort))
}

type Compare = (a: ItemDto, b: ItemDto) => number

function comparatorFor(sort: SortKey): Compare {
  switch (sort) {
    case 'priorityDueDesc':
      return chain(byPriority, byDueDesc, byCreatedAsc)
    case 'dueDesc':
      return chain(byDueDesc, byPriority, byCreatedAsc)
    case 'due':
      return chain(byDueAsc, byPriority, byCreatedAsc)
    case 'created':
      return byCreatedDesc
    case 'updated':
      return byUpdatedDesc
  }
}

/** 先頭から順に比べ、差がついたところで決める。 */
function chain(...comparators: Compare[]): Compare {
  return (a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b)
      if (result !== 0) return result
    }
    return 0
  }
}

/** 文字列の大小。ISO 8601 の日時は辞書順が時系列順になる。 */
function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** 値なしを末尾に置く（SQL の `ASC NULLS LAST`）。 */
function nullsLast<T>(
  a: T | null,
  b: T | null,
  compare: (a: T, b: T) => number,
): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return compare(a, b)
}

/** 重要度。小さいほど高く、重要度なしは末尾。 */
const byPriority: Compare = (a, b) =>
  nullsLast(a.priority, b.priority, (x, y) => x - y)

const byDueAsc: Compare = (a, b) => nullsLast(a.dueAt, b.dueAt, compareText)

/**
 * 期限の新しい順。**期限なしは末尾**にする（`DESC NULLS LAST`）。
 *
 * PostgreSQL の `DESC` は既定で NULLS FIRST だが、それだと期限を決めて
 * いないものが先頭に固まり、期限で並べた意味が無くなる。昇順と揃えて、
 * どちらでも期限なしは下に置く。
 */
const byDueDesc: Compare = (a, b) =>
  nullsLast(a.dueAt, b.dueAt, (x, y) => compareText(y, x))

const byCreatedAsc: Compare = (a, b) => compareText(a.createdAt, b.createdAt)

const byCreatedDesc: Compare = (a, b) => compareText(b.createdAt, a.createdAt)

/**
 * 直近さわったものが上。
 *
 * 未送信の変更を抱えている間、手元の `updatedAt` はこの端末の時計で先に
 * 進んでいる（`patchTodos`）。サーバーが打ち直した時刻とは少しずれるが、
 * どちらも「さわった順」なので並びは変わらない。
 */
const byUpdatedDesc: Compare = (a, b) => compareText(b.updatedAt, a.updatedAt)

/**
 * 一覧から消えた Item の代わりに、カーソルを置く先の id。
 *
 * 編集した結果その一覧の条件から外れる（完了にする・タグを外す・期限を
 * 動かす）ことは多く、そのたびに先頭へ飛ばされると、続けて片付けられない。
 * **消える前にその下にあったもの**へ移す（消したメールの次が選ばれる、
 * よくある動き）。
 *
 * 下に残っているものが無ければ上へ遡る。まとめて消えた（一括操作の）ときも、
 * 残っているものの中でいちばん近い下、次に近い上、の順で選ぶ。
 * どれも残っていなければ null（呼び出し側が先頭に戻す）。
 */
export function nextFocusAfterRemoval<T extends { id: string }>(
  before: T[],
  removedId: string,
  alive: Set<string>,
): string | null {
  const index = before.findIndex((item) => item.id === removedId)
  if (index < 0) return null

  for (let i = index + 1; i < before.length; i++) {
    const id = before[i]!.id
    if (alive.has(id)) return id
  }
  for (let i = index - 1; i >= 0; i--) {
    const id = before[i]!.id
    if (alive.has(id)) return id
  }
  return null
}

/**
 * グループ順（docs/08-todo-management.md 8.2、RTM の Group by）。
 *
 * 並びより上位の区切り。並び替え済みの配列をグループごとに分けるだけで、
 * 中身の順序は変えない（＝各グループの中は、選んでいる並びのまま）。
 * 元の配列での位置（index）も持たせる。一覧のキーボードのカーソルは
 * グループをまたいだ1本の並びに対して動くため、表示側で見出しを
 * 挟んでも同じ index で参照できるようにするため。
 */
export interface ItemGroup<T> {
  key: string
  /** グループなし（GroupKey が 'none'）のときは空文字。見出しを出さない目印。 */
  label: string
  items: { item: T; index: number }[]
}

const PRIORITY_GROUP_ORDER: (Priority | null)[] = [1, 2, 3, null]
const STATUS_GROUP_ORDER: ItemStatus[] = ['in_progress', 'backlog', 'closed']

export function groupItems<T extends ItemDto>(
  items: T[],
  groupBy: GroupKey,
): ItemGroup<T>[] {
  const indexed = items.map((item, index) => ({ item, index }))

  if (groupBy === 'none') return [{ key: 'none', label: '', items: indexed }]

  if (groupBy === 'priority') {
    return PRIORITY_GROUP_ORDER.map((priority) => ({
      key: String(priority),
      label: priority ? `重要度: ${PRIORITY_LABELS[priority]}` : '重要度なし',
      items: indexed.filter(({ item }) => item.priority === priority),
    })).filter((group) => group.items.length > 0)
  }

  return STATUS_GROUP_ORDER.map((status) => ({
    key: status,
    label: STATUS_LABELS[status],
    items: indexed.filter(({ item }) => item.status === status),
  })).filter((group) => group.items.length > 0)
}
