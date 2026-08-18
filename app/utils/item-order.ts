import type { ItemDto, SortKey } from '~~/shared/types/item'

/**
 * 一覧の並び（docs/08-todo-management.md 8.2）。
 *
 * サーバーの ORDER BY（server/utils/items.ts の `orderByFor`）と同じ順序を
 * クライアントでも作る。追加や重要度の変更を応答を待たずに反映するとき、
 * 正しい位置へ置くために要る。ここがずれていると、取り直しのたびに行が飛ぶ。
 */
export function sortItems(items: ItemDto[], sort: SortKey): ItemDto[] {
  return [...items].sort(comparatorFor(sort))
}

type Compare = (a: ItemDto, b: ItemDto) => number

function comparatorFor(sort: SortKey): Compare {
  switch (sort) {
    case 'priority':
      return chain(byPriority, byDueAsc, byCreatedAsc)
    case 'priorityDueDesc':
      return chain(byPriority, byDueDesc, byCreatedAsc)
    case 'due':
      return chain(byDueAsc, byPriority, byCreatedAsc)
    case 'created':
      return byCreatedDesc
    case 'title':
      return chain(byTitle, byCreatedAsc)
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

/** 値なしを先頭に置く（PostgreSQL の `DESC` は既定で NULLS FIRST）。 */
function nullsFirst<T>(
  a: T | null,
  b: T | null,
  compare: (a: T, b: T) => number,
): number {
  if (a === null) return b === null ? 0 : -1
  if (b === null) return 1
  return compare(a, b)
}

/** 重要度。小さいほど高く、重要度なしは末尾。 */
const byPriority: Compare = (a, b) =>
  nullsLast(a.priority, b.priority, (x, y) => x - y)

const byDueAsc: Compare = (a, b) => nullsLast(a.dueAt, b.dueAt, compareText)

const byDueDesc: Compare = (a, b) =>
  nullsFirst(a.dueAt, b.dueAt, (x, y) => compareText(y, x))

const byCreatedAsc: Compare = (a, b) => compareText(a.createdAt, b.createdAt)

const byCreatedDesc: Compare = (a, b) => compareText(b.createdAt, a.createdAt)

const byTitle: Compare = (a, b) => compareText(a.title, b.title)
