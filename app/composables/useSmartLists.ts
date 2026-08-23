import type { SmartListDto, SmartListInput } from '~~/shared/types/smart-list'

/**
 * スマートリスト（docs/08-todo-management.md 8.6）の唯一の入口。
 *
 * 正本はサーバー。画面をまたいで同じ内容を見せたいので useFetch のキーで
 * 共有する（タグ・アイコンと同じ）。
 */

/**
 * 直近の一覧の控え。
 *
 * リストの中身（Item）は手元の IndexedDB から作れるので、条件さえあれば
 * オフラインでもリストを開ける。取得を待たずに出せるよう、前回の内容を
 * 控えておく（docs/12-offline.md 12.9）。
 */
const STORAGE_KEY = 'datalake:smart-lists'

/** 最後に控えた内容。同じ内容を何度も書き出さないために持つ。 */
let lastRemembered: string | null = null

export function useSmartLists() {
  const { data, refresh, status } = useFetch<SmartListDto[]>('/api/smart-lists', {
    key: 'smart-lists',
    default: () => [],
  })

  /** 取得が終わったか。空の一覧（1つも作っていない）と区別する。 */
  const loaded = computed(() => status.value === 'success')

  const remembered = useState<SmartListDto[]>('smart-lists:remembered', () => [])

  onMounted(() => {
    if (remembered.value.length > 0) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) remembered.value = JSON.parse(raw) as SmartListDto[]
    } catch {
      // 読めない環境では、取得が終わるまでリストが出ないだけ
    }
  })

  watch(
    data,
    (list) => {
      // 取得できたときだけ控え直す。既定値（空）で控えを消さないため
      if (!import.meta.client || !list || !loaded.value) return

      const json = JSON.stringify(list)
      if (json === lastRemembered) return
      lastRemembered = json

      remembered.value = list
      try {
        localStorage.setItem(STORAGE_KEY, json)
      } catch {
        // 書けなくても、その回の表示は変わらない
      }
    },
    { immediate: true },
  )

  /** 取得が終わるまでは控えを使う。終わったあとは、0件でも取得結果を使う。 */
  const lists = computed<SmartListDto[]>(() =>
    loaded.value ? (data.value ?? []) : remembered.value,
  )

  function byId(id: string): SmartListDto | null {
    return lists.value.find((list) => list.id === id) ?? null
  }

  /** `g` `m` の候補。名前の前方一致 → 部分一致の順に返す。 */
  function suggest(query: string): SmartListDto[] {
    const q = query.trim().toLowerCase()
    if (!q) return lists.value

    const starts = lists.value.filter((list) => list.name.toLowerCase().startsWith(q))
    const includes = lists.value.filter(
      (list) => !list.name.toLowerCase().startsWith(q) && list.name.toLowerCase().includes(q),
    )
    return [...starts, ...includes]
  }

  async function create(input: SmartListInput): Promise<SmartListDto> {
    const created = await $fetch<SmartListDto>('/api/smart-lists', {
      method: 'POST',
      body: input,
    })
    await refresh()
    return created
  }

  /**
   * 直す。**応答を待たずに手元へ反映する。**
   *
   * 一覧の右上で並びを選び直したときも、その場でリストを直している
   * （docs/08-todo-management.md 8.6）。待ってから反映すると、選んだ直後に
   * 選択が元へ戻って見える。送れなかったときだけ元に戻す。
   */
  async function update(id: string, input: SmartListInput): Promise<SmartListDto> {
    const before = data.value ?? []
    data.value = before.map((list) => (list.id === id ? { ...list, ...input } : list))

    try {
      const updated = await $fetch<SmartListDto>(`/api/smart-lists/${id}`, {
        method: 'PATCH',
        body: input,
      })
      await refresh()
      return updated
    } catch (error) {
      data.value = before
      throw error
    }
  }

  async function remove(id: string): Promise<void> {
    await $fetch(`/api/smart-lists/${id}`, { method: 'DELETE' })
    await refresh()
  }

  return { lists, loaded, refresh, byId, suggest, create, update, remove }
}
