import type { TagColor } from '../types/tag'

/**
 * タグの並べ替え（docs/09-tags.md 9.3「並べ替え」）。
 */

/**
 * 「色ごとに並べる」ときの色の順。
 *
 * 色見本（PICKER_TAG_COLORS）と同じ色相の順（赤 → 橙 → 黄 → 緑 → 青 → 紫 → 茶 → 灰）。
 * 色見本から外した色は、見た目の近い色のすぐ後ろに置く。淡い色は対になる濃い色の後ろ。
 * 濃い色を親のタグ、淡い色をその下の細かいタグに使い分けたとき、親が先に来るようにするため。
 * 色なしは最後。
 */
export const TAG_COLOR_SORT_ORDER: readonly TagColor[] = [
  'rtm-red', 'rtm-red-pale', 'red',
  'rtm-orange', 'rtm-orange-pale', 'orange', 'rtm-amber', 'rtm-amber-pale',
  'yellow', 'rtm-gold', 'rtm-gold-pale',
  'rtm-olive', 'rtm-olive-pale', 'olive',
  'rtm-green', 'rtm-green-pale', 'green', 'rtm-forest', 'rtm-forest-pale',
  'teal',
  'blue', 'rtm-sky', 'rtm-sky-pale',
  'rtm-blue', 'rtm-blue-pale', 'rtm-navy', 'rtm-navy-pale', 'indigo',
  'rtm-purple', 'rtm-purple-pale', 'purple',
  'pink',
  'rtm-mauve', 'rtm-mauve-pale',
  'brown',
  'gray',
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
