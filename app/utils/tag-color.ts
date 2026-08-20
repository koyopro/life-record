import type { TagColor } from '~~/shared/types/tag'

/** タグの色から CSS のカスタムプロパティ参照を作る。未設定は既定の色。 */
export function tagColorVar(color: TagColor | null): string {
  return `var(--tag-${color ?? 'default'})`
}
