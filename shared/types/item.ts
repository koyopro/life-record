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

/**
 * ソート軸（docs/08-todo-management.md 8.2）。
 *
 * 名前は以前のものを引き継いでいる（`due` は期限日の**昇順**）。
 * 覚えてある値（設定・localStorage）をそのまま読めるようにするため。
 */
export const SORT_KEYS = [
  'priorityDueDesc',
  'dueDesc',
  'due',
  'created',
] as const
export type SortKey = (typeof SORT_KEYS)[number]

export const SORT_LABELS: Record<SortKey, string> = {
  // 同じ重要度の中では、期限の新しいものが上（期限切れは下に沈む）
  priorityDueDesc: '重要度順',
  dueDesc: '期限日降順',
  due: '期限日昇順',
  created: '追加日降順',
}

/**
 * 無くした軸の読み替え。覚えてある値が古い名前のこともあるため。
 *
 * 「重要度順（期限が近い順）」は、いまの「重要度順」へ寄せる。
 * ここに無いもの（タイトル順）は、その画面の既定に戻す。
 */
const REPLACED_SORT_KEYS: Record<string, SortKey> = {
  priority: 'priorityDueDesc',
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
  /**
   * 日記でピン留めしているか（docs/03-functional-spec.md 3.3）。
   *
   * 立っていると、その日の「この日にやったこと」の先頭に出る。
   */
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface ItemDetailDto extends ItemDto {
  /**
   * サーバーがこの応答を作った時刻（ISO 8601）。
   *
   * 取得と保存は別々に飛ぶため、**保存より前に出した取得の応答が保存の後で
   * 届く**ことがある。届いた応答が、こちらの保存より前のものかを判断する
   * ために持つ（docs/15-client-state.md 14.2）。
   *
   * 入れるのは詳細の取得（`GET /api/items/:id`）だけ。書き出しなど、
   * 手元の控えと突き合わせない用途では持たない。
   */
  fetchedAt?: string
  /** 日付昇順、同一日付内は position 昇順（docs/03-functional-spec.md 3.1）。 */
  sections: SectionDto[]
  /**
   * 一覧カードに出す本文（`body`）と同じ Section の id。最初に作られたもの。
   *
   * 詳細画面で編集する枠は**当日の Section**であって、これではない
   * （docs/03-functional-spec.md 3.2）。日をまたいで書き足しても、
   * 一覧の抜粋がその Item の最初の記録のまま動かないようにするために持つ。
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

/**
 * 覚えてある値からソート軸を読み取る。分からなければ null
 * （呼び出し側がその画面の既定を使う）。
 */
export function toSortKey(value: unknown): SortKey | null {
  if (isSortKey(value)) return value
  if (typeof value !== 'string') return null
  return REPLACED_SORT_KEYS[value] ?? null
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
