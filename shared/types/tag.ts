export const TAG_NAME_MAX_LENGTH = 50

/**
 * RTM のタグ色見本（docs/09-tags.md 9.2）。
 *
 * RTM は 6 列 × 4 行の 24 色で、淡い色と濃い色が対になっている。
 * 対の相手がそのまま文字色になる（淡い背景には濃い文字、濃い背景には淡い文字）。
 * RTM から import した色をそのまま使えるよう、同じ 24 色を同じ並びで持つ。
 *
 * 並びは RTM の色見本と同じ（1・3 行目が淡い側、2・4 行目が濃い側）。
 */
export const RTM_TAG_COLORS = [
  'rtm-sky-pale',
  'rtm-blue-pale',
  'rtm-navy-pale',
  'rtm-purple-pale',
  'rtm-mauve-pale',
  'rtm-red-pale',
  'rtm-sky',
  'rtm-blue',
  'rtm-navy',
  'rtm-purple',
  'rtm-mauve',
  'rtm-red',
  'rtm-orange-pale',
  'rtm-amber-pale',
  'rtm-gold-pale',
  'rtm-olive-pale',
  'rtm-green-pale',
  'rtm-forest-pale',
  'rtm-orange',
  'rtm-amber',
  'rtm-gold',
  'rtm-olive',
  'rtm-green',
  'rtm-forest',
] as const

/**
 * RTM の色見本を持つ前から使っている、独自の色見本。
 *
 * すでにこの色が付いているタグがあるので消さずに残す
 * （Postgres の enum は値を後から削れない）。新しく選ぶなら
 * RTM と同じ色のほうがそろうため、色見本では RTM の 24 色を先に出す。
 */
export const LEGACY_TAG_COLORS = [
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

/**
 * タグの色分け（docs/09-tags.md 9.2）。
 *
 * 固定の色見本から選ぶ形にする。任意の色を許すと表記ゆれ（似た色の乱立）が
 * 起きやすく、CSS 側の明暗対応も色の数だけ要るため。
 */
export const TAG_COLORS = [...RTM_TAG_COLORS, ...LEGACY_TAG_COLORS] as const

export type TagColor = (typeof TAG_COLORS)[number]

export type RtmTagColor = (typeof RTM_TAG_COLORS)[number]

export function isTagColor(value: unknown): value is TagColor {
  return TAG_COLORS.includes(value as TagColor)
}

/** 色見本 1 つ分。塗りつぶしの背景色と、その上に乗せる文字色の組。 */
export interface TagColorSwatch {
  background: string
  foreground: string
}

/**
 * 色見本ごとの基準色。app/assets/css/main.css の --tag-* / --tag-*-fg と
 * 同じ値にそろえる（tests/tag-color.spec.ts が食い違いを見張る）。
 *
 * RTM の 24 色は明暗どちらでも RTM と同じ見え方にするため、
 * light-dark() を使わず 16 進の値をそのまま使う。
 * 独自の 12 色は明暗で振る値なので、ここにはライト側の値を置く。
 */
export const TAG_COLOR_SWATCHES: Record<TagColor, TagColorSwatch> = {
  'rtm-sky-pale': { background: '#d6e6f6', foreground: '#337fcc' },
  'rtm-blue-pale': { background: '#e0ecff', foreground: '#206cff' },
  'rtm-navy-pale': { background: '#dfe2ff', foreground: '#0000cc' },
  'rtm-purple-pale': { background: '#e0d5f9', foreground: '#5229a3' },
  'rtm-mauve-pale': { background: '#fde9f4', foreground: '#854f61' },
  'rtm-red-pale': { background: '#ffe3e3', foreground: '#cc0000' },
  'rtm-sky': { background: '#337fcc', foreground: '#d6e6f6' },
  'rtm-blue': { background: '#206cff', foreground: '#e0ecff' },
  'rtm-navy': { background: '#0000cc', foreground: '#dfe2ff' },
  'rtm-purple': { background: '#5229a3', foreground: '#e0d5f9' },
  'rtm-mauve': { background: '#854f61', foreground: '#fde9f4' },
  'rtm-red': { background: '#cc0000', foreground: '#ffe3e3' },
  'rtm-orange-pale': { background: '#fff0e1', foreground: '#ec7000' },
  'rtm-amber-pale': { background: '#fadcb3', foreground: '#b36d00' },
  'rtm-gold-pale': { background: '#f3e7b3', foreground: '#ab8b00' },
  'rtm-olive-pale': { background: '#ffffd4', foreground: '#636330' },
  'rtm-green-pale': { background: '#e0ebd5', foreground: '#73a341' },
  'rtm-forest-pale': { background: '#f1f5ec', foreground: '#006633' },
  'rtm-orange': { background: '#ec7000', foreground: '#fff0e1' },
  'rtm-amber': { background: '#b36d00', foreground: '#fadcb3' },
  'rtm-gold': { background: '#ab8b00', foreground: '#f3e7b3' },
  'rtm-olive': { background: '#636330', foreground: '#ffffd4' },
  'rtm-green': { background: '#73a341', foreground: '#e0ebd5' },
  'rtm-forest': { background: '#006633', foreground: '#f1f5ec' },
  red: { background: '#c94f4f', foreground: '#ffffff' },
  orange: { background: '#c17a2e', foreground: '#ffffff' },
  yellow: { background: '#a8891f', foreground: '#ffffff' },
  olive: { background: '#7c8a3c', foreground: '#ffffff' },
  green: { background: '#3f8f5f', foreground: '#ffffff' },
  teal: { background: '#2f8f88', foreground: '#ffffff' },
  blue: { background: '#3f7bc9', foreground: '#ffffff' },
  indigo: { background: '#5a5fc7', foreground: '#ffffff' },
  purple: { background: '#8a5fc7', foreground: '#ffffff' },
  pink: { background: '#c75f96', foreground: '#ffffff' },
  brown: { background: '#8a6a4a', foreground: '#ffffff' },
  gray: { background: '#7c7c74', foreground: '#ffffff' },
}

/**
 * RTM の背景色（16進）から、対応する色見本を引く。
 *
 * RTM のタグは色見本そのものを背景色として持つので、完全一致で引ける。
 * import で色を丸めずに済ませるためのもの（scripts/import-rtm.ts）。
 */
export function rtmTagColorFromHex(hex: string): RtmTagColor | null {
  const normalized = hex.trim().toLowerCase()
  return (
    RTM_TAG_COLORS.find(
      (color) => TAG_COLOR_SWATCHES[color].background === normalized,
    ) ?? null
  )
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
