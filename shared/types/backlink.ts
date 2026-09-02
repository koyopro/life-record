import type { ItemStatus, Priority } from './item'

/**
 * バックリンク（そのページを指している本文）。
 *
 * このサービスは関連を保存せず導出する（Diary と Section を日付だけで
 * 結ぶのと同じ考え方。docs/02-data-model.md 2.8）。ページどうしの相互
 * リンクも中間テーブルを持たず、**本文に書いた1方向のリンクだけを保存
 * し、逆方向はその文字列を含む本文を探して導き出す**
 * （docs/11-scrapbox-notation.md 11.11）。
 *
 * 保存されるのが1方向だけなので、片側を消したときに反対側が残る、
 * という食い違いが起こらない。
 */

/** バックリンク1件。 */
export interface Backlink {
  /** 行ごとの id（`section:<id>` など）。 */
  id: string
  kind: 'item' | 'section' | 'diary'
  /** 並べ替えのキー。Item は作成日、Section と Diary はその日付。 */
  date: string
  /** 遷移先。 */
  path: string
  /** 見出し。Item と Section はタスク名、Diary は日付。 */
  title: string
  /** リンクを書いた箇所の前後を切り出したもの。 */
  excerpt: string
  /** タスクに紐づく行（Item と Section）だけ。日記は null。 */
  item: BacklinkItem | null
}

/** バックリンクの裏にあるタスク。一覧のカードと同じ顔で出すために持つ。 */
export interface BacklinkItem {
  id: string
  status: ItemStatus
  priority: Priority | null
  tags: string[]
  dueAt: string | null
  dueHasTime: boolean
}

/** 返す件数の上限。 */
export const BACKLINK_LIMIT = 100

/**
 * バックリンクを引ける（＝本文からリンクとして書ける）アプリ内のパスか。
 *
 * 記法が認めるパスと同じものだけを受ける（docs/11-scrapbox-notation.md
 * 11.4）。任意の文字列を渡せると、本文の部分一致検索を別の入口から
 * 呼べてしまい、バックリンクという意味から外れるため。
 */
const LINKABLE_PATHS = [
  /^\/items\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\/diary\/\d{4}-\d{2}-\d{2}$/,
  /^\/diary\/month\/\d{4}-\d{2}$/,
]

export function isLinkablePath(value: unknown): value is string {
  return (
    typeof value === 'string' && LINKABLE_PATHS.some((pattern) => pattern.test(value))
  )
}
