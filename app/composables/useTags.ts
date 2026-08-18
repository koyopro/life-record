import type { TagDto } from '~~/shared/types/tag'

/**
 * タグ一覧。候補表示と絞り込みで使う。
 *
 * 画面をまたいで同じ内容を見せたいので useFetch のキーで共有する。
 *
 * 取れなかったとき（オフライン）は、手元の Item から数え直したものを見せる。
 * タグは Item に付いている名前の集まりなので、ローカルにある Item だけでも
 * 十分に組み立てられる（docs/12-offline.md 12.9）。
 */
export function useTags() {
  const { data, refresh, pending, error } = useFetch<TagDto[]>('/api/tags', {
    key: 'tags',
    default: () => [],
  })

  const store = useItemStore()

  /** 手元の Item から数えたタグ。id はサーバーのものではないと分かる形にする。 */
  const local = computed<TagDto[]>(() => {
    const counts = new Map<string, number>()
    for (const item of store.items.value) {
      if (item.syncState === 'pending_delete') continue
      for (const name of item.tags) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ id: `local:${name}`, name, count }))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
  })

  const tags = computed(() => {
    const fetched = data.value ?? []
    if (error.value || fetched.length === 0) return local.value
    return fetched
  })

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
