import type { TagColor, TagDto } from '~~/shared/types/tag'

/**
 * 直近に取れたタグの色を控えておく場所（名前 → 色）。
 *
 * リロードは Service Worker が返す殻から始まるため、サーバー描画の内容が
 * 無く、`/api/tags` の応答が届くまでタグの色を持たない（docs/12-offline.md 12.2）。
 * その間は手元の Item から数えたタグを出しており、色を持たないので
 * すべて既定の灰色になってしまう。前回の色を控え、届くまでこれで描く。
 *
 * 正本はサーバー。ここにあるのは初期表示のための控えでしかない
 * （docs/15-client-state.md 14.4）。
 */
const COLORS_STORAGE_KEY = 'datalake:tag-colors'

/**
 * 最後に控えた内容。
 *
 * `useTags()` は一覧のカードそれぞれから呼ばれるので、取得のたびに
 * 同じ内容を何十回も書き出さないよう、変わったときだけ書く。
 * 読み書きするのはブラウザだけなので、サーバー側で共有されることはない。
 */
let lastRememberedColors: string | null = null

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

  /** 覚えている色。取得が終わるまでの間だけ使う。 */
  const rememberedColors = useState<Record<string, TagColor | null>>(
    'tags:remembered-colors',
    () => ({}),
  )

  onMounted(() => {
    if (Object.keys(rememberedColors.value).length > 0) return
    try {
      const raw = localStorage.getItem(COLORS_STORAGE_KEY)
      if (raw) rememberedColors.value = JSON.parse(raw) as Record<string, TagColor | null>
    } catch {
      // 読めない環境（プライベートブラウズなど）では、取得が終わるまで既定の色
    }
  })

  /**
   * 手元の Item から数えたタグ。id はサーバーのものではないと分かる形にする。
   *
   * 数えるのはサーバー（GET /api/tags）と同じく未完了のものだけ。
   * 繋がっているかどうかで件数が変わって見えないようにする。
   */
  const local = computed<TagDto[]>(() => {
    const counts = new Map<string, number>()
    for (const item of store.items.value) {
      if (item.syncState === 'pending_delete') continue
      // 完了済みしか無いタグも、サーバー側と同じく0件として残す
      const open = item.status === 'closed' ? 0 : 1
      for (const name of item.tags) counts.set(name, (counts.get(name) ?? 0) + open)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ id: `local:${name}`, name, count, color: null }))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
  })

  /** サーバーから届いた一覧（取れていなければ、手元の Item から数えたもの）。 */
  const fetched = computed<TagDto[]>(() => {
    const list = data.value ?? []
    if (!error.value && list.length > 0) return list

    // 色だけは覚えているものを重ねる。件数は手元の Item から数えたほうが新しい
    return local.value.map((tag) => ({
      ...tag,
      color: rememberedColors.value[tag.name] ?? null,
    }))
  })

  /*
   * この端末で直した色は、届いた内容より優先する。取りに行った後に直すと、
   * その応答が後から届いて直す前に戻るため（docs/15-client-state.md 14.2 の 4）。
   */
  const { list: tags, edit, revert } = useLocalEdits<TagDto>('tags', fetched)

  // 取れたら控え直す。次のリロードで最初から色を出せるようにする
  watch(
    tags,
    (list) => {
      if (!import.meta.client || !list?.length) return

      const next: Record<string, TagColor | null> = {}
      for (const tag of list) next[tag.name] = tag.color

      const json = JSON.stringify(next)
      if (json === lastRememberedColors) return
      lastRememberedColors = json

      rememberedColors.value = next
      try {
        localStorage.setItem(COLORS_STORAGE_KEY, json)
      } catch {
        // 書けなくても、その回の表示は変わらない
      }
    },
    { immediate: true },
  )

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
   * 当てるのは「この端末で直した分」（`useLocalEdits`）。取りに行った後に
   * 直すと、その応答が後から届いて**直す前の色に戻る**ので、届いた内容より
   * こちらを優先する。届いた内容が追いついたら自動で落ちる。
   *
   * 送れなかったら元へ戻し、呼んだ側が知らせられるよう投げ直す。
   */
  async function setColor(id: string, color: TagColor | null) {
    edit(id, { color })

    try {
      await $fetch<TagDto>(`/api/tags/${id}`, { method: 'PATCH', body: { color } })
    } catch (e) {
      revert(id)
      throw e
    }
  }

  /**
   * タグの名前を変える。付いている全 Item に反映される（docs/09-tags.md 9.3）。
   *
   * 色と違い、これは Item 側の持ち物（`tags`）まで変える操作なので、
   * 応答を待ってから反映する。手元の写し（IndexedDB）にある古い名前は
   * サーバーから取り直して揃える。取り直しに失敗しても、リネーム自体は
   * 済んでいるので投げ直さない（次の取得で揃う）。
   *
   * 変更先の名前がすでにあれば、サーバーが2つのタグを統合して返す。
   * 統合で id も件数も変わるため、応答をそのまま一覧へ当てるのではなく
   * 取り直す（消えたほうの行を残さないため）。
   */
  async function rename(id: string, name: string): Promise<TagDto> {
    const updated = await $fetch<TagDto>(`/api/tags/${id}`, {
      method: 'PATCH',
      body: { name },
    })

    await refresh()
    // Item に付いている名前も変わっている。一覧・詳細の表示を揃える
    await store.fetchFromServer().catch(() => false)

    return updated
  }

  return { tags, pending, refresh, suggest, colorOf, setColor, rename }
}
