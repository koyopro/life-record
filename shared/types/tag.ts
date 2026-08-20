export const TAG_NAME_MAX_LENGTH = 50

/**
 * タグの色分け（docs/09-tags.md 9.2）。
 *
 * 固定の色見本から選ぶ形にする。任意の色を許すと表記ゆれ（似た色の乱立）が
 * 起きやすく、CSS 側の明暗対応も色の数だけ要るため。
 */
export const TAG_COLORS = [
  'red',
  'orange',
  'yellow',
  'olive',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
  'brown',
  'gray',
] as const

export type TagColor = (typeof TAG_COLORS)[number]

export function isTagColor(value: unknown): value is TagColor {
  return TAG_COLORS.includes(value as TagColor)
}

export interface TagDto {
  id: string
  name: string
  /** そのタグが付いている Item の件数。 */
  count: number
  /** 色。未設定なら null（表示側は既定の色で出す）。 */
  color: TagColor | null
}

/**
 * タグ名を正規化する（docs/09-tags.md 9.2）。
 *
 * RTM に倣い大文字小文字を区別しない。表記ゆれで同じ意味のタグが
 * 増えるのを防ぐため、保存前に必ずここを通す。
 * サーバーとクライアントで結果をそろえるため共有に置く。
 *
 * 正規化できない場合は null を返す。
 */
export function normalizeTagName(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null
  if (trimmed.length > TAG_NAME_MAX_LENGTH) return null
  // 空白・カンマ・# は SmartAdd の区切りと衝突する
  if (/[\s,#]/.test(trimmed)) return null
  return trimmed
}

/** 入力文字列を、正規化済みタグ名の配列に変換する。重複は取り除く。 */
export function parseTagNames(input: string): string[] {
  const names = input
    .split(/[\s,]+/)
    .map((part) => part.replace(/^#/, ''))
    .map(normalizeTagName)
    .filter((name): name is string => name !== null)

  return [...new Set(names)]
}
