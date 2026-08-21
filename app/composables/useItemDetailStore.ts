import type { ItemDetailDto, SectionDto } from '~~/shared/types/item'
import {
  nextPositionIn,
  pickPrimarySection,
  sortSectionsForDisplay,
} from '~/utils/section-order'
import {
  createSaveScheduler,
  IDLE_STATUS,
  type SaveStatus,
} from '~/utils/save-scheduler'

/**
 * Item の詳細（本文と作業記録＝Section）の置き場。
 *
 * Section は IndexedDB に持たない（docs/12-offline.md 12.9）ため、
 * TODO のメタデータのように「ローカルが唯一の読み取り元」にはできない。
 * 代わりに、**画面が読むのはこのストアの控えだけ**にする。
 *
 * - サーバーから取った内容も、編集した内容も、同じ控えへ書く
 * - 編集はローカル（控え）へ即座に反映し、送信は裏で遅らせて行う
 * - まだ送れていない鍵には、サーバーの内容を当てない
 *
 * こうすると、編集してから画面を切り替えて戻っても編集前の内容は出ない。
 * 画面ごとに `useFetch` の結果と控えの2つを見ていた頃は、どちらか片方だけが
 * 新しくなり、戻ったときに古い方が出ていた（docs/15-client-state.md）。
 */

/**
 * 保存の状態を画面へ渡すための入れ物。
 *
 * 遅延送信は画面より長生きするのでモジュールに置く。反応する値
 * （useState）は Nuxt の文脈でしか作れないため、クライアントで最初に
 * ストアを使ったときに受け取る。サーバー描画中は送信そのものが起きない。
 */
let statusStore: Ref<Record<string, SaveStatus>> | null = null

const scheduler = createSaveScheduler({
  onStatus: (key, status) => {
    if (!statusStore) return
    statusStore.value = { ...statusStore.value, [key]: status }
  },
})

/** 本文（先頭 Section）の保存に使う鍵。 */
function bodyKey(itemId: string): string {
  return `${itemId}|body`
}

/** 作業記録1件の保存に使う鍵。 */
function sectionKey(itemId: string, sectionId: string): string {
  return `${itemId}|section|${sectionId}`
}

export function useItemDetailStore() {
  const { cache, set } = usePersistedRecordCache<ItemDetailDto>('item-detail-cache')
  const statuses = useState<Record<string, SaveStatus>>(
    'item-detail-save',
    () => ({}),
  )
  if (import.meta.client) statusStore = statuses

  const itemStore = useItemStore()

  /** 画面が読む詳細。取得が終わっていなくても、控えがあれば出せる。 */
  function byId(id: string): ItemDetailDto | null {
    return cache.value[id] ?? null
  }

  function statusOf(key: string): SaveStatus {
    return statuses.value[key] ?? IDLE_STATUS
  }

  /**
   * サーバーから届いた詳細を、控えへ重ねる形にする。
   *
   * **まだ送れていない本文だけはローカルを残す。**それ以外（日付・並び順・
   * 作業記録の増減・メタデータ）はサーバーが正なので、そのまま採る。
   * 丸ごと捨てると、書いている最中に「この日にやったこと」のような
   * 触っていない部分まで古いままになる。
   */
  function mergeServer(id: string, server: ItemDetailDto): ItemDetailDto {
    const local = byId(id)
    if (!local) return server

    const merged = server.sections.map((section) => {
      const busy =
        scheduler.busy(sectionKey(id, section.id)) ||
        (section.id === server.primarySectionId && scheduler.busy(bodyKey(id)))
      if (!busy) return section
      const mine = local.sections.find((s) => s.id === section.id)
      return mine ? { ...section, body: mine.body } : section
    })

    const next = replaceSections(server, merged)

    // Section を作っている最中（まだ id が無い）。書いた本文を消さない
    if (!next.primarySectionId && scheduler.busy(bodyKey(id))) {
      return { ...next, body: local.body }
    }
    return next
  }

  /**
   * サーバーから取り直し、控えへ重ねる。画面は setup で1度だけ呼ぶ。
   *
   * 重ね方は mergeServer が持つ。まだ送れていない本文だけはローカルを残す
   * （`mergeServerItems` が未送信の変更を上書きしないのと同じ規則）。
   */
  function track(id: Ref<string> | ComputedRef<string>) {
    const { data, error } = useFetch<ItemDetailDto>(
      () => `/api/items/${id.value}`,
      { watch: [id] },
    )

    // immediate: true にしておく。SSR で最初から入っている画面では値が
    // 変わる瞬間が無く、immediate 無しだと watch が一度も走らない
    watch(
      data,
      (value) => {
        if (value) set(id.value, mergeServer(id.value, value))
      },
      { immediate: true },
    )

    /*
     * 画面から出ていくときに、待っているものを送っておく。
     *
     * 遅延送信はストア（モジュール）に残るので、アプリの中で画面を移る
     * だけなら取りこぼさない。裏へ回ったときも visibilitychange で送る。
     *
     * ただし**ページごと消える瞬間（タブを閉じる・再読み込み・別サイトへ）
     * は間に合わないことがある**。送信そのものが打ち切られるため。ここを
     * 確実にするには、送るものを IndexedDB へ置いて次回に持ち越す必要が
     * あり、それは Section と日記をオフライン対応させる話になる
     * （docs/12-offline.md 12.9 / docs/15-client-state.md）。
     */
    if (import.meta.client) {
      const onLeaving = () => {
        if (document.visibilityState === 'hidden') void scheduler.flushAll()
      }
      const onPageHide = () => void scheduler.flushAll()

      onMounted(() => {
        document.addEventListener('visibilitychange', onLeaving)
        window.addEventListener('pagehide', onPageHide)
      })
      onBeforeUnmount(() => {
        document.removeEventListener('visibilitychange', onLeaving)
        window.removeEventListener('pagehide', onPageHide)
      })
    }

    return { error }
  }

  // --- 控えの書き換え ---------------------------------------------------

  /** 詳細を差し替える。Section の並びと先頭 Section はここで揃える。 */
  function replaceSections(
    detail: ItemDetailDto,
    sections: SectionDto[],
  ): ItemDetailDto {
    const ordered = sortSectionsForDisplay(sections)
    const primary = pickPrimarySection(sections)
    return {
      ...detail,
      sections: ordered,
      primarySectionId: primary?.id ?? null,
      // body は一覧カードに出す本文（先頭 Section の写し）
      body: primary?.body ?? null,
    }
  }

  function update(
    id: string,
    change: (detail: ItemDetailDto) => ItemDetailDto,
  ): ItemDetailDto | null {
    const current = byId(id)
    if (!current) return null
    const next = change(current)
    set(id, next)
    return next
  }

  /**
   * 一覧カードに出す本文の写し（IndexedDB）も揃える。
   *
   * 一覧は `useItemStore`（IndexedDB）から読むので、ここを更新しないと
   * 本文を書き換えたあと一覧へ戻っても、次の取り直しまで古い抜粋が出る。
   * サーバーには Section の保存で既に届いているため、送信は積まない。
   */
  async function syncBodyCopy(id: string) {
    await itemStore.setBodyCopy(id, byId(id)?.body ?? null)
  }

  // --- 本文（先頭 Section） ---------------------------------------------

  /**
   * ストアが持っている本文。
   *
   * まだ何も取れていないことを `null` で表し、「本文が空」と区別する。
   * 一緒にしてしまうと、本文を消している最中に、画面が古い写しへ
   * 戻って見える。
   */
  function bodyOf(id: string): string | null {
    const detail = byId(id)
    if (!detail) return null
    const primary = detail.sections.find((s) => s.id === detail.primarySectionId)
    return primary?.body ?? detail.body ?? ''
  }

  /**
   * 本文を書き換える。控えへ即座に反映し、送信は遅らせて裏で行う。
   *
   * Section がまだ無いときは、写しの本文だけを先に持たせる。実際の
   * Section は、何か書かれたときの最初の送信で作る。
   */
  function editBody(id: string, value: string) {
    update(id, (detail) => {
      const primaryId = detail.primarySectionId
      if (!primaryId) return { ...detail, body: value }
      return {
        ...detail,
        body: value,
        sections: detail.sections.map((s) =>
          s.id === primaryId ? { ...s, body: value } : s,
        ),
      }
    })

    scheduler.schedule(bodyKey(id), () => sendBody(id, value))
  }

  async function sendBody(id: string, value: string) {
    const detail = byId(id)
    const primaryId = detail?.primarySectionId ?? null

    if (primaryId) {
      const updated = await $fetch<SectionDto>(`/api/sections/${primaryId}`, {
        method: 'PATCH',
        body: { body: value },
      })
      applySavedSection(id, updated)
      await syncBodyCopy(id)
      return
    }

    // まだ Section がない。空文字のまま作っても意味がないので、
    // 実際に何か書かれてから作る
    if (!value.trim()) return

    const created = await $fetch<SectionDto>('/api/sections', {
      method: 'POST',
      body: { itemId: id, body: value },
    })
    update(id, (current) =>
      replaceSections(current, [...current.sections, created]),
    )
    await syncBodyCopy(id)
  }

  function bodyStatus(id: string): SaveStatus {
    return statusOf(bodyKey(id))
  }

  // --- 作業記録（本文以外の Section） -------------------------------------

  function sectionBodyOf(id: string, sectionId: string): string {
    return byId(id)?.sections.find((s) => s.id === sectionId)?.body ?? ''
  }

  function editSectionBody(id: string, sectionId: string, value: string) {
    update(id, (detail) => ({
      ...detail,
      body: sectionId === detail.primarySectionId ? value : detail.body,
      sections: detail.sections.map((s) =>
        s.id === sectionId ? { ...s, body: value } : s,
      ),
    }))

    scheduler.schedule(sectionKey(id, sectionId), async () => {
      const updated = await $fetch<SectionDto>(`/api/sections/${sectionId}`, {
        method: 'PATCH',
        body: { body: value },
      })
      applySavedSection(id, updated)
      if (updated.id === byId(id)?.primarySectionId) await syncBodyCopy(id)
    })
  }

  function sectionStatus(id: string, sectionId: string): SaveStatus {
    return statusOf(sectionKey(id, sectionId))
  }

  /**
   * 保存できた Section を控えへ当てる。
   *
   * **本文だけはローカルを正とする。**送信の往復中にも書き足せるので、
   * 応答（送った時点の値）をそのまま当てると、書いた分が一瞬戻って見える。
   * 日付・並び順・updatedAt はサーバーが決めるので応答で確定させる。
   */
  function applySavedSection(id: string, updated: SectionDto) {
    update(id, (detail) =>
      replaceSections(
        detail,
        detail.sections.map((s) =>
          s.id === updated.id ? { ...updated, body: s.body } : s,
        ),
      ),
    )
  }

  /**
   * 一手で終わる操作（追加・日付変更・並べ替え・削除）。
   *
   * 先に控えを書き換えて画面を進め、失敗したら元へ戻す。本文の保存と違って
   * 打鍵のたびには起きないので、遅延送信には載せない。
   */
  async function act(
    id: string,
    optimistic: (detail: ItemDetailDto) => ItemDetailDto,
    send: () => Promise<void>,
  ) {
    const before = byId(id)
    update(id, optimistic)
    try {
      await send()
    } catch (e) {
      if (before) set(id, before)
      throw e
    }
  }

  /** 作業記録を1件足す。作られた Section を返す。 */
  async function addSection(id: string, date: string): Promise<SectionDto> {
    const created = await $fetch<SectionDto>('/api/sections', {
      method: 'POST',
      body: { itemId: id, date, body: '' },
    })
    update(id, (detail) => replaceSections(detail, [...detail.sections, created]))
    return created
  }

  async function changeSectionDate(id: string, sectionId: string, date: string) {
    const detail = byId(id)
    // 日付が変われば、移った先の末尾に置かれる（サーバーと同じ規則）
    const position = detail ? nextPositionIn(detail.sections, date) : 0

    await act(
      id,
      (current) =>
        replaceSections(
          current,
          current.sections.map((s) =>
            s.id === sectionId ? { ...s, date, position } : s,
          ),
        ),
      async () => {
        const updated = await $fetch<SectionDto>(`/api/sections/${sectionId}`, {
          method: 'PATCH',
          body: { date },
        })
        applySavedSection(id, updated)
      },
    )
  }

  /** 同じ日付の記録を並べ替える。並びはまとめて送る。 */
  async function reorderSections(id: string, ids: string[]) {
    await act(
      id,
      (current) =>
        replaceSections(
          current,
          current.sections.map((s) => {
            const position = ids.indexOf(s.id)
            return position >= 0 ? { ...s, position } : s
          }),
        ),
      async () => {
        const updated = await $fetch<SectionDto[]>('/api/sections/reorder', {
          method: 'POST',
          body: { ids },
        })
        for (const section of updated) applySavedSection(id, section)
      },
    )
  }

  async function removeSection(id: string, sectionId: string) {
    const wasPrimary = byId(id)?.primarySectionId === sectionId

    await act(
      id,
      (current) =>
        replaceSections(
          current,
          current.sections.filter((s) => s.id !== sectionId),
        ),
      async () => {
        await $fetch(`/api/sections/${sectionId}`, { method: 'DELETE' })
      },
    )

    // 本文の記録を消したら、次の記録が本文に繰り上がる
    if (wasPrimary) await syncBodyCopy(id)
  }

  return {
    byId,
    bodyOf,
    bodyStatus,
    editBody,
    sectionBodyOf,
    sectionStatus,
    editSectionBody,
    addSection,
    changeSectionDate,
    reorderSections,
    removeSection,
    flushAll: () => scheduler.flushAll(),
    track,
  }
}
