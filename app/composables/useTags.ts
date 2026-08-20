import type { TagColor, TagDto } from '~~/shared/types/tag'

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
      .map(([name, count]) => ({ id: `local:${name}`, name, count, color: null }))
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

  /** タグ名から色を引く。未取得・未設定なら null（表示側は既定の色で出す）。 */
  function colorOf(name: string): TagColor | null {
    return tags.value.find((tag) => tag.name === name)?.color ?? null
  }

  /**
   * タグの色を変える。
   *
   * 応答を待たずに手元の一覧へ当てる。待ってから反映すると、送信と
   * 取り直しの2往復ぶん（回線によっては数秒）押した色に変わらない。
   * 色は表示のためだけのものなので、先に出して構わない。
   *
   * 当てる先は useFetch の `data` そのもの。キー（`tags`）を共有しているので、
   * 一覧のカードや詳細に出ているタグの色もその場で変わる。
   *
   * 送れたら応答に揃える（リネームでの統合があれば id や件数も変わる）。
   * 送れなかったら元へ戻し、呼んだ側が知らせられるよう投げ直す。
   */
  async function setColor(id: string, color: TagColor | null) {
    const before = data.value ?? []
    data.value = before.map((tag) => (tag.id === id ? { ...tag, color } : tag))

    try {
      const updated = await $fetch<TagDto>(`/api/tags/${id}`, {
        method: 'PATCH',
        body: { color },
      })
      data.value = (data.value ?? []).map((tag) => (tag.id === id ? updated : tag))
    } catch (e) {
      data.value = before
      throw e
    }
  }

  return { tags, pending, refresh, suggest, colorOf, setColor }
}
