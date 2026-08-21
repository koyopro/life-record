import type { IconDto } from '~~/shared/types/icon'

/**
 * 自分で登録したアイコン（docs/11-scrapbox-notation.md 11.8）。
 *
 * 本文の `:name:` を画像に置き換えるための対応表と、`:` の候補に出す一覧。
 * 画面をまたいで同じ内容を見せたいので useFetch のキーで共有する。
 */

/**
 * 直近の対応表（名前 → 画像のパス）を控えておく場所。
 *
 * リロードは Service Worker が返す殻から始まるため、`/api/icons` が届くまで
 * 対応表を持たない（docs/12-offline.md 12.2）。その間 `:name:` は文字のまま
 * 出てしまい、本文が一瞬崩れて見える。前回の内容を控え、届くまでこれで描く。
 */
const STORAGE_KEY = 'datalake:icons'

/** 最後に控えた内容。同じ内容を何度も書き出さないために持つ。 */
let lastRemembered: string | null = null

export function useIcons() {
  const { data, refresh, pending, status } = useFetch<IconDto[]>('/api/icons', {
    key: 'icons',
    default: () => [],
  })

  /** 取得が終わったか。空の一覧（1つも登録していない）と区別する。 */
  const loaded = computed(() => status.value === 'success')

  const icons = computed(() => data.value ?? [])

  /** 覚えている対応表。取得が終わるまでの間だけ使う。 */
  const remembered = useState<Record<string, string>>('icons:remembered', () => ({}))

  onMounted(() => {
    if (Object.keys(remembered.value).length > 0) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) remembered.value = JSON.parse(raw) as Record<string, string>
    } catch {
      // 読めない環境では、取得が終わるまで `:name:` のまま出る
    }
  })

  watch(
    data,
    (list) => {
      // 取得できたときだけ控え直す。既定値（空）で控えを消さないため
      if (!import.meta.client || !list || !loaded.value) return

      const next: Record<string, string> = {}
      for (const icon of list) next[icon.name] = icon.path

      const json = JSON.stringify(next)
      if (json === lastRemembered) return
      lastRemembered = json

      remembered.value = next
      try {
        localStorage.setItem(STORAGE_KEY, json)
      } catch {
        // 書けなくても、その回の表示は変わらない
      }
    },
    { immediate: true },
  )

  /**
   * 本文を描くときに渡す対応表（renderLine の options）。
   *
   * 取得が終わるまでは控えを使う。終わったあとは、たとえ0件でも取得結果を
   * 使う（消したアイコンが控えのせいで出続けないようにする）。
   */
  const map = computed<Record<string, string>>(() =>
    loaded.value
      ? Object.fromEntries(icons.value.map((icon) => [icon.name, icon.path]))
      : remembered.value,
  )

  /** `:` の候補。名前の前方一致 → 部分一致の順に返す。 */
  function search(query: string, limit = 4): IconDto[] {
    const q = query.trim().toLowerCase()
    if (!q) return icons.value.slice(0, limit)

    const starts = icons.value.filter((icon) => icon.name.startsWith(q))
    const includes = icons.value.filter(
      (icon) => !icon.name.startsWith(q) && icon.name.includes(q),
    )
    return [...starts, ...includes].slice(0, limit)
  }

  /** 登録する。同じ名前があれば画像を差し替える（サーバー側で upsert）。 */
  async function create(name: string, path: string): Promise<IconDto> {
    const created = await $fetch<IconDto>('/api/icons', {
      method: 'POST',
      body: { name, path },
    })
    await refresh()
    return created
  }

  async function remove(id: string): Promise<void> {
    await $fetch(`/api/icons/${id}`, { method: 'DELETE' })
    await refresh()
  }

  return { icons, pending, refresh, map, search, create, remove }
}
