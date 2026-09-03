import type { Backlink } from '~~/shared/types/backlink'
import {
  findBacklinks,
  mergeRemembered,
  parseBacklinkEntries,
  rememberBacklinks,
  type BacklinkEntry,
} from '~/utils/backlink-cache'
import { withinTimeout } from '~/utils/offline/sync-runner'

/**
 * 「このページを指しているもの」＝バックリンクの唯一の入口
 * （docs/11-scrapbox-notation.md 11.11）。
 *
 * 画面は控えだけを読み、取得はここでする（docs/15-client-state.md 14.2 の 1）。
 * 一度見たページは**その場で出して、裏で取り直す**。取り直しの最中も前回の
 * 内容を出したままにするので、月を行き来しても「読み込み中…」に戻らない。
 *
 * バックリンクはサーバーの部分一致検索から作るもので、手元では組み立て直せない
 * （docs/12-offline.md 12.9）。オフラインでは控えをそのまま出す。
 */

/** 控えの置き場。リロード後も即座に出せるよう localStorage にも書く。 */
const STORAGE_KEY = 'datalake:backlinks'

/** 最後に控えた内容。同じ内容を何度も書き出さないために持つ。 */
let lastRemembered: string | null = null

export function useBacklinkStore() {
  /** ページごとの控え。新しく取ったものが先頭。 */
  const entries = useState<BacklinkEntry[]>('backlinks:entries', () => [])
  /** いま取りに行っているパス。 */
  const loading = useState<Record<string, boolean>>('backlinks:loading', () => ({}))
  /**
   * localStorage の控えを見終わったか。
   *
   * 見る前に「まだありません」と出すと、控えを持っているページでも一瞬
   * 無いと言うことになる。見終わるまでは「読み込み中…」のままにする。
   */
  const hydrated = useState('backlinks:hydrated', () => false)

  /** そのページの控え。持っていなければ null（「0件」と区別する）。 */
  function linksOf(path: string): Backlink[] | null {
    return findBacklinks(entries.value, path)
  }

  function remember(path: string, links: Backlink[]): void {
    entries.value = rememberBacklinks(entries.value, path, links)
  }

  function setLoading(path: string, value: boolean): void {
    loading.value = { ...loading.value, [path]: value }
  }

  /**
   * サーバーから取り直し、控えへ入れる。画面は setup で1度だけ呼ぶ。
   *
   * 取れなくても画面は成り立つ（控えがあればそれを出す）。
   */
  function track(path: Ref<string> | ComputedRef<string>) {
    /** 控えを持っていないページを、取りに行っている（これから行く）間だけ true。 */
    const pending = computed(
      () =>
        linksOf(path.value) === null &&
        (Boolean(loading.value[path.value]) || !hydrated.value),
    )

    /*
     * サーバー描画。取った内容をそのまま状態へ入れる（useState は payload で
     * ブラウザへ渡るので、最初の描画にバックリンクが載る）。
     */
    if (import.meta.server) {
      const { data } = useFetch<Backlink[]>('/api/backlinks', {
        query: computed(() => ({ path: path.value })),
      })
      watch(
        data,
        (links) => {
          if (links) remember(path.value, links)
        },
        { immediate: true },
      )
      return { pending, refresh: async () => {} }
    }

    /**
     * 取りに行く。**どのパスの応答かは、頼んだ時点のパスで決める。**
     * 応答が返るころには別の月へ移っていることがあり、そのときの
     * `path.value` で控えると、隣の月の内容として覚えてしまう。
     */
    async function fetchOne(target: string): Promise<void> {
      setLoading(target, true)
      try {
        const links = await withinTimeout((signal) =>
          $fetch<Backlink[]>('/api/backlinks', { query: { path: target }, signal }),
        )
        remember(target, links)
      } catch {
        // オフラインや失敗のときは、控えをそのまま出したままにする
      } finally {
        setLoading(target, false)
      }
    }

    onMounted(() => {
      // リロードは Service Worker が返す殻から始まる（サーバー描画の内容が
      // 無い）ので、控えはここで拾う（docs/12-offline.md 12.2）
      if (!hydrated.value) {
        try {
          const raw = localStorage.getItem(STORAGE_KEY)
          if (raw) entries.value = mergeRemembered(entries.value, parseBacklinkEntries(raw))
        } catch {
          // 読めない環境では、取得が終わるまで出ないだけ
        }
        hydrated.value = true
      }
    })

    watch(
      entries,
      (list) => {
        if (!import.meta.client || list.length === 0) return

        const json = JSON.stringify(list)
        if (json === lastRemembered) return
        lastRemembered = json

        try {
          localStorage.setItem(STORAGE_KEY, json)
        } catch {
          // 書けなくても、その回の表示は変わらない（次の取得で出る）
        }
      },
      { deep: true },
    )

    watch(path, (value) => void fetchOne(value), { immediate: true })

    return { pending, refresh: () => fetchOne(path.value) }
  }

  return { linksOf, track }
}
