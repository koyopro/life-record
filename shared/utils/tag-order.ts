import { LEGACY_TAG_COLORS, type TagColor } from '../types/tag'

/**
 * タグの並べ替え（docs/09-tags.md 9.3「並べ替え」）。
 */

/**
 * 「色ごとに並べる」ときの色の順。
 *
 * 色相の順（赤 → 橙 → 黄 → 緑 → 青 → 紫）に並べ、同じ色相では濃い色を
 * 淡い色の前に置く。濃い色を親のタグ、淡い色をその下の細かいタグに
 * 使い分けたとき、親が先に来るようにするため。
 * RTM の色見本を持つ前の独自の色はその後ろ、色なしは最後。
 */
const RTM_HUES = [
  'red',
  'orange',
  'amber',
  'gold',
  'olive',
  'green',
  'forest',
  'sky',
  'blue',
  'navy',
  'purple',
  'mauve',
] as const

export const TAG_COLOR_SORT_ORDER: readonly TagColor[] = [
  ...RTM_HUES.flatMap((hue) => [`rtm-${hue}`, `rtm-${hue}-pale`] as TagColor[]),
  ...LEGACY_TAG_COLORS,
]

function colorRank(color: TagColor | null): number {
  if (color === null) return TAG_COLOR_SORT_ORDER.length
  const index = TAG_COLOR_SORT_ORDER.indexOf(color)
  return index === -1 ? TAG_COLOR_SORT_ORDER.length : index
}

/**
 * 色ごとにまとめて並べる。同じ色のタグどうしは今の並びを保つ
 * （安定な並べ替え）。手で並べた順を、色をまたがない範囲で残すため。
 */
export function sortByColorGroup<T extends { color: TagColor | null }>(tags: readonly T[]): T[] {
  return tags
    .map((tag, index) => ({ tag, index }))
    .sort((a, b) => colorRank(a.tag.color) - colorRank(b.tag.color) || a.index - b.index)
    .map(({ tag }) => tag)
}

/** 並びの中で1つを動かす。範囲外なら元の並びを返す。 */
export function moveInList<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return [...list]
  }
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

/**
 * 名前で指定した順に並べ、指定されなかったものはその後ろに今の順で続ける。
 * 一部だけを並べ替えたいとき（MCP の reorder_tags）に使う。
 */
export function orderByNames<T extends { name: string }>(tags: readonly T[], names: readonly string[]): T[] {
  const byName = new Map(tags.map((tag) => [tag.name, tag]))
  const head: T[] = []
  for (const name of names) {
    const tag = byName.get(name)
    if (tag && !head.includes(tag)) head.push(tag)
  }
  return [...head, ...tags.filter((tag) => !head.includes(tag))]
}
