import type { ItemStatus } from './item'

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
  /** Item と Section のみ。 */
  status: ItemStatus | null
}

export interface SearchQuery {
  q: string
  kind: SearchKind
  status: ItemStatus | 'all'
  /** 正規化済みのタグ名。空なら絞らない。 */
  tag: string
  /** YYYY-MM-DD。空なら絞らない。 */
  from: string
  to: string
}

/** 抜粋の長さ。一致箇所の前後を合わせてこの程度に収める。 */
export const SEARCH_EXCERPT_LENGTH = 120

export function isSearchKind(value: unknown): value is SearchKind {
  return SEARCH_KINDS.includes(value as SearchKind)
}
