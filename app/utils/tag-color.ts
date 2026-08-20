import type { TagColor } from '~~/shared/types/tag'

/** タグの色から CSS のカスタムプロパティ参照を作る。未設定は既定の色。 */
export function tagColorVar(color: TagColor | null): string {
  return `var(--tag-${color ?? 'default'})`
}

/**
 * タグの色に対する文字色の参照を作る。
 *
 * RTM の色見本には淡い色（白文字だと読めない）があるので、背景色と対にして
 * 色見本ごとに文字色を持つ（main.css の --tag-*-fg）。
 */
export function tagTextColorVar(color: TagColor | null): string {
  return `var(--tag-${color ?? 'default'}-fg)`
}
