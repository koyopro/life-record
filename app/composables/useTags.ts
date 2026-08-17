import type { TagDto } from '~~/shared/types/tag'

/**
 * タグ一覧。候補表示と絞り込みで使う。
 *
 * 画面をまたいで同じ内容を見せたいので useState で共有する。
 */
export function useTags() {
  const { data, refresh, pending } = useFetch<TagDto[]>('/api/tags', {
    key: 'tags',
    default: () => [],
  })

  const tags = computed(() => data.value ?? [])

  /** 入力途中の文字列に対する候補。すでに付いているものは除く。 */
  function suggest(query: string, exclude: string[] = []): TagDto[] {
    const normalized = query.trim().toLowerCase().replace(/^#/, '')
    return tags.value
      .filter((tag) => !exclude.includes(tag.name))
      .filter((tag) => !normalized || tag.name.includes(normalized))
      .slice(0, 8)
  }

  return { tags, pending, refresh, suggest }
}
