import type { RecurrenceBasis } from './recurrence'

/**
 * 進行状態（docs/02-data-model.md 2.2）。
 *
 * かつては未整理の一時置き場として `inbox` を分けていたが、`backlog` との
 * 差が運用上あいまいで、どちらに置くか迷うだけだったため「未着手」に
 * 統合した（値は `backlog` のまま）。
 */
export const ITEM_STATUSES = ['backlog', 'in_progress', 'closed'] as const

export type ItemStatus = (typeof ITEM_STATUSES)[number]

export const STATUS_LABELS: Record<ItemStatus, string> = {
  backlog: '未着手',
  in_progress: '対応中',
  closed: '完了',
}

/** 重要度。小さいほど高い（docs/02-data-model.md 2.3）。 */
export const PRIORITIES = [1, 2, 3] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_LABELS: Record<Priority, string> = {
  1: '高',
  2: '中',
  3: '低',
}

/** ソート軸（docs/08-todo-management.md 8.2）。 */
export const SORT_KEYS = [
  'priority',
  'priorityDueDesc',
  'due',
  'created',
  'title',
] as const
export type SortKey = (typeof SORT_KEYS)[number]

export const SORT_LABELS: Record<SortKey, string> = {
  priority: '重要度順',
  // 「今日」リストの既定。期限が近い（新しい）ものから並べる
  priorityDueDesc: '重要度順（期限は新しい順）',
  due: '期限日順',
  created: '追加日順',
  title: 'タイトル順',
}

/**
 * グループ順（RTM の Group by に合わせる）。並びより上位の区切りで、
 * 選ぶと見出し付きの塊に分けて出す。並び自体は各グループの中で効く。
 */
export const GROUP_KEYS = ['none', 'priority', 'status'] as const
export type GroupKey = (typeof GROUP_KEYS)[number]

export const GROUP_LABELS: Record<GroupKey, string> = {
  none: 'なし',
  priority: '重要度',
  status: 'ステータス',
}

export interface ItemDto {
  id: string
  title: string
  status: ItemStatus
  priority: Priority | null
  /** 関連する URL。1件だけ持つ。 */
  url: string | null
  /** 期限。ISO 8601。 */
  dueAt: string | null
  /** 期限に時刻の指定があるか。false なら日付のみの期限。 */
  dueHasTime: boolean
  /** 一覧カードに出す本文（先頭 Section の body）。なければ null。 */
  body: string | null
  /** 付いているタグ名。正規化済み・名前順。 */
  tags: string[]
  /** 繰り返し規則（RRULE）。null なら繰り返しなし。 */
  recurrenceRule: string | null
  recurrenceBasis: RecurrenceBasis | null
  /** 同じ繰り返しから生まれた Item 群の識別子。 */
  seriesId: string | null
  /** 完了にした日時。ISO 8601。closed 以外は null（docs/02-data-model.md 2.3）。 */
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SectionDto {
  id: string
  date: string
  body: string
  /** 同じ日付の中での表示順（docs/02-data-model.md 2.4）。 */
  position: number
  createdAt: string
  updatedAt: string
}

export interface ItemDetailDto extends ItemDto {
  /** 日付降順、同一日付内は position 昇順（docs/03-functional-spec.md 3.1）。 */
  sections: SectionDto[]
  /**
   * 「本文」として扱う Section の id。最初に作られたもの。
   * 一覧カードに出す本文（`body`）と同じ Section を指す。
   */
  primarySectionId: string | null
}

/** Item に対して変更できる項目。 */
export interface ItemPatch {
  title?: string
  url?: string | null
  status?: ItemStatus
  priority?: Priority | null
  dueAt?: string | null
  dueHasTime?: boolean
  recurrenceRule?: string | null
  recurrenceBasis?: RecurrenceBasis | null
}

export function isItemStatus(value: unknown): value is ItemStatus {
  return ITEM_STATUSES.includes(value as ItemStatus)
}

export function isSortKey(value: unknown): value is SortKey {
  return SORT_KEYS.includes(value as SortKey)
}

export function isGroupKey(value: unknown): value is GroupKey {
  return GROUP_KEYS.includes(value as GroupKey)
}

export function isPriority(value: unknown): value is Priority {
  return value === 1 || value === 2 || value === 3
}

export const URL_MAX_LENGTH = 2000

/**
 * 別タブで開いてよい URL か。
 *
 * `javascript:` のようなスキームを弾く。リンクとして開く以上、
 * 保存の時点で通さない。
 */
export function isOpenableUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim())
}
