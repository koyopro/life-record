import type { ItemStatus, Priority } from './item'

/**
 * 横断検索（docs/03-functional-spec.md 3.6）。
 *
 * Item / Section / Diary は別の概念のまま保ちつつ、結果は日付順に
 * 混ぜて出す。「あのとき何を書いたか」を探すときに、どの入れ物に
 * 書いたかを思い出さなくてよいようにするため。
 */

export const SEARCH_KINDS = ['all', 'item', 'section', 'diary'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  all: 'すべて',
  item: 'タスク名',
  section: '作業記録',
  diary: '日記',
}

/**
 * この行の裏にあるタスク（Item と Section のみ。日記は持たない）。
 *
 * 一覧のカード（`ItemCard`）と同じ見た目で出すために要るぶんだけを持つ
 * （docs/03-functional-spec.md 3.6）。探し当てたタスクが、一覧で見ている
 * ものと違う顔つきで並ぶと、同じものだと結び付けるのに一拍かかるため。
 */
export interface SearchHitItem {
  status: ItemStatus
  /** 左端の帯に出す重要度。 */
  priority: Priority | null
  tags: string[]
  dueAt: string | null
  dueHasTime: boolean
}

export interface SearchHit {
  /** 同じ Item に複数の作業記録が当たるので、行ごとの id を持つ。 */
  id: string
  kind: Exclude<SearchKind, 'all'>
  /** 並べ替えのキー。Item は作成日、Section と Diary はその日付。 */
  date: string
  /** 遷移先。 */
  path: string
  /** 見出し。Item と Section はタスク名、Diary は日付。 */
  title: string
  /** 一致した箇所の前後を切り出したもの。 */
  excerpt: string
  /** タスクに紐づく行（Item と Section）だけ。日記は null。 */
  item: SearchHitItem | null
}

export interface SearchQuery {
  q: string
  kind: SearchKind
  /** タスクの表示方法（未完了 / 完了）。日記には当てはまらない。 */
  view: SearchView
  /** 正規化済みのタグ名。空なら絞らない。 */
  tag: string
  /** YYYY-MM-DD。空なら絞らない。 */
  from: string
  to: string
}

/**
 * タスクの表示方法。一覧（`ItemListView`）の「未完了 / 完了」と同じ
 * 切り替えで、既定は未完了。
 *
 * リスト（`ListView`）と違い「すべて」は持たない。検索は元から
 * 「言葉で絞った結果」なので、状態でも絞らない見方は結果が広がりすぎる。
 */
export const SEARCH_VIEWS = ['open', 'completed'] as const
export type SearchView = (typeof SEARCH_VIEWS)[number]

export const SEARCH_VIEW_LABELS: Record<SearchView, string> = {
  open: '未完了',
  completed: '完了',
}

export function isSearchView(value: unknown): value is SearchView {
  return SEARCH_VIEWS.includes(value as SearchView)
}

/** 抜粋の長さ。一致箇所の前後を合わせてこの程度に収める。 */
export const SEARCH_EXCERPT_LENGTH = 120

export function isSearchKind(value: unknown): value is SearchKind {
  return SEARCH_KINDS.includes(value as SearchKind)
}
