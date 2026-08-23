import { isGroupKey, isSortKey, type GroupKey, type SortKey } from './item'

/**
 * スマートリスト（docs/08-todo-management.md 8.6）。
 *
 * よく見る絞り込みに名前を付けて残しておくもの（RTM の Smart List）。
 * 絞り込み（タグ）・表示方法・グループ順・並びを1組にして持ち、開けば
 * いつも同じ見え方で出る。
 *
 * 中身（どの Item が入るか）は持たない。条件だけを持ち、出すときに
 * 手元の Item から選び直す。タスクを足しても外しても、リストの側を
 * 直さずに済むため。
 */

/** 名前の長さの上限。タブや候補に並べるので、長すぎると読み取れない。 */
export const SMART_LIST_NAME_MAX_LENGTH = 50

/**
 * 表示方法。
 *
 * `all`（すべて）は**状態を見ない**。完了したものも同じ見た目で並べ、
 * タイトルに取り消し線も引かない。「終わったかどうか」ではなく
 * 「その条件に当てはまるものを全部見たい」ときのための見方だから。
 */
export const LIST_VIEWS = ['open', 'completed', 'all'] as const
export type ListView = (typeof LIST_VIEWS)[number]

export const LIST_VIEW_LABELS: Record<ListView, string> = {
  open: '未完了',
  completed: '完了',
  all: 'すべて',
}

export function isListView(value: unknown): value is ListView {
  return LIST_VIEWS.includes(value as ListView)
}

export interface SmartListDto {
  id: string
  name: string
  /** 絞り込むタグ名。null なら絞り込まない。 */
  tag: string | null
  view: ListView
  groupBy: GroupKey
  sort: SortKey
  createdAt: string
}

/** 作成・更新で受け取る中身。 */
export interface SmartListInput {
  name: string
  tag: string | null
  view: ListView
  groupBy: GroupKey
  sort: SortKey
}

/** 入力を名前として整える。使えない場合は null。 */
export function normalizeSmartListName(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.length > SMART_LIST_NAME_MAX_LENGTH) return null
  return trimmed
}

/**
 * 受け取った値をスマートリストの中身として読む。読めなければ null。
 *
 * サーバー（API）とクライアント（フォーム）の両方から使い、
 * 「どこまでが正しい入力か」を1か所で決める。
 */
export function toSmartListInput(payload: {
  name?: unknown
  tag?: unknown
  view?: unknown
  groupBy?: unknown
  sort?: unknown
}): SmartListInput | null {
  const name = normalizeSmartListName(String(payload.name ?? ''))
  if (!name) return null

  const rawTag = payload.tag
  const tag = typeof rawTag === 'string' && rawTag.trim() ? rawTag.trim() : null

  if (!isListView(payload.view)) return null
  if (!isGroupKey(payload.groupBy)) return null
  if (!isSortKey(payload.sort)) return null

  return { name, tag, view: payload.view, groupBy: payload.groupBy, sort: payload.sort }
}
