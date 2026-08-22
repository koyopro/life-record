import type { ItemDetailDto, SectionDto } from '~~/shared/types/item'
import {
  nextPositionIn,
  pickPrimarySection,
  pickTodaySection,
  sortSectionsForDisplay,
} from '~/utils/section-order'
import { toAppDate } from '~~/shared/utils/date'
import {
  createSaveScheduler,
  IDLE_STATUS,
  type SaveStatus,
} from '~/utils/save-scheduler'
import { createSavedVersions } from '~/utils/saved-versions'
import { mergeSections } from '~/utils/section-merge'

/**
 * Item の詳細（本文と作業記録＝Section）の置き場。
 *
 * Section は IndexedDB に持たない（docs/12-offline.md 12.9）ため、
 * TODO のメタデータのように「ローカルが唯一の読み取り元」にはできない。
 * 代わりに、**画面が読むのはこのストアの控えだけ**にする。
 *
 * - サーバーから取った内容も、編集した内容も、同じ控えへ書く
 * - 編集はローカル（控え）へ即座に反映し、送信は裏で遅らせて行う
 * - まだ送れていない鍵・送れなかった鍵には、サーバーの内容を当てない
 * - 送れた鍵でも、こちらの保存より古い内容（＝保存より前に出した取得の
 *   応答）は当てない
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

/** 保存できた版（サーバーが返した更新日時）の控え。遅延送信と同じくモジュールに置く。 */
const savedVersions = createSavedVersions()

/**
 * 当日の枠（＝画面が既定で編集している作業記録）の保存に使う鍵。
 *
 * 日付ではなく Item ごとに持つ。日付をまたいだ瞬間に鍵が変わると、
 * まだ送れていない前日の分の保存状態が行方不明になるため。
 */
function todayKey(itemId: string): string {
  return `${itemId}|today`
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
   * その鍵の本文は、サーバーから届いた内容より手元の方が新しいか。
   *
   * 次の3つのどれかに当たれば、手元を残す。
   *
   * 1. まだ送れていない・送信中（`busy`）
   * 2. 送ったが失敗した（`error`）。送れていない以上、手元にしか無い
   * 3. 送れているが、届いた内容の更新日時がこちらの保存より古い
   *    （＝保存より前に出した取得の応答が、保存の後で届いた）
   *
   * 3 が要るのは、送り終わった瞬間に 1 の守りが外れるため。取得と保存は
   * 別々に飛ぶので、行き違いは待ち時間の長い回線ほど起きやすい。
   */
  function localIsNewer(key: string, serverUpdatedAt: string | null): boolean {
    if (scheduler.busy(key)) return true
    if (statusOf(key).state === 'error') return true
    return savedVersions.isStale(key, serverUpdatedAt)
  }

  /**
   * サーバーから届いた詳細を、控えへ重ねる形にする。
   *
   * **手元の方が新しい本文だけはローカルを残す**（`localIsNewer`）。
   * それ以外（日付・並び順・作業記録の増減・メタデータ）はサーバーが正なので、
   * そのまま採る。丸ごと捨てると、書いている最中に「この日にやったこと」の
   * ような触っていない部分まで古いままになる。
   *
   * 当日の枠はまだ Section が無いこともあるが、その分の打鍵は控えではなく
   * 下書き（`drafts`）に置いてあるので、ここで守る必要はない。
   */
  function mergeServer(id: string, server: ItemDetailDto): ItemDetailDto {
    const local = byId(id)
    if (!local) return server

    const todaySectionId = pickTodaySection(server.sections, toAppDate())?.id

    const fetchedAt = server.fetchedAt

    const merged = mergeSections(local.sections, server.sections, {
      keepsLocalBody: (section) =>
        localIsNewer(sectionKey(id, section.id), section.updatedAt) ||
        (section.id === todaySectionId &&
          localIsNewer(todayKey(id), section.updatedAt)),
      /*
       * その日の最初の打鍵で作った記録（sendTodayBody）は、作る前に出した
       * 取得の応答には入っていない。応答をそのまま採ると、書いた本文ごと
       * 空に戻って見えるため、応答を作った時刻より後の保存は残す。
       * 応答に時刻が無ければ判断できないので、そのときは残さない。
       */
      savedAfterResponse: (section) =>
        Boolean(fetchedAt) &&
        savedVersions.isStale(sectionKey(id, section.id), fetchedAt ?? null),
    })

    return replaceSections(server, merged)
  }

  /**
   * サーバーから取り直し、控えへ重ねる。画面は setup で1度だけ呼ぶ。
   *
   * 重ね方は mergeServer が持つ。手元の方が新しい本文だけはローカルを残す
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

  // --- 当日の枠（既定で編集している作業記録） -----------------------------
  //
  // Item は本文を持たないため、画面が「本文」として出している枠は
  // **その日の作業記録**（date が当日の Section）として保存する
  // （docs/03-functional-spec.md 3.2）。日をまたいで書き足しても、
  // 前の日の記録は前の日のものとして残る。

  /**
   * その日の Section がまだ無いあいだ、打った内容を置いておく場所。
   *
   * 空の Section を先に作ってしまうと、開いただけの日が記録として残る。
   * 何か書かれた時点で初めて Section を作り、作れたらここは捨てる。
   *
   * 一覧カードの写し（`detail.body`）は最初の Section を指すので、
   * そちらに混ぜてはいけない（過去の記録が当日の枠に出てしまう）。
   */
  const drafts = useState<Record<string, string>>(
    'item-detail-today-draft',
    () => ({}),
  )

  function setDraft(id: string, value: string) {
    drafts.value = { ...drafts.value, [id]: value }
  }

  function clearDraft(id: string) {
    if (!(id in drafts.value)) return
    const { [id]: _dropped, ...rest } = drafts.value
    drafts.value = rest
  }

  /**
   * 当日の枠に出す内容。
   *
   * まだ何も取れていないことを `null` で表し、「その日の記録が空」と
   * 区別する。一緒にしてしまうと、消している最中に古い写しへ戻って見える。
   */
  function todayBodyOf(id: string, today: string): string | null {
    const detail = byId(id)
    if (!detail) return null
    const section = pickTodaySection(detail.sections, today)
    if (section) return section.body
    return drafts.value[id] ?? ''
  }

  /**
   * 当日の枠を書き換える。控えへ即座に反映し、送信は遅らせて裏で行う。
   *
   * その日の Section がまだ無ければ下書きへ置き、最初の送信で作る。
   */
  function editTodayBody(id: string, today: string, value: string) {
    const section = pickTodaySection(byId(id)?.sections ?? [], today)

    if (section) {
      update(id, (detail) =>
        replaceSections(
          detail,
          detail.sections.map((s) =>
            s.id === section.id ? { ...s, body: value } : s,
          ),
        ),
      )
    } else {
      setDraft(id, value)
    }

    scheduler.schedule(todayKey(id), () => sendTodayBody(id, today, value))
  }

  async function sendTodayBody(id: string, today: string, value: string) {
    // 送るときに引き直す。打ってから送るまでの間に、その日の Section が
    // できていることがある（別のタブ・直前の送信）
    const section = pickTodaySection(byId(id)?.sections ?? [], today)

    if (section) {
      const updated = await $fetch<SectionDto>(`/api/sections/${section.id}`, {
        method: 'PATCH',
        body: { body: value },
      })
      // 当日の枠は Section と鍵が別なので、両方に印を付ける
      savedVersions.mark(todayKey(id), updated.updatedAt)
      applySavedSection(id, updated)
      if (updated.id === byId(id)?.primarySectionId) await syncBodyCopy(id)
      return
    }

    // まだその日の Section がない。空文字のまま作っても意味がないので、
    // 実際に何か書かれてから作る
    if (!value.trim()) return

    const created = await $fetch<SectionDto>('/api/sections', {
      method: 'POST',
      body: { itemId: id, date: today, body: value },
    })
    savedVersions.mark(todayKey(id), created.updatedAt)
    savedVersions.mark(sectionKey(id, created.id), created.updatedAt)
    clearDraft(id)
    update(id, (current) =>
      replaceSections(current, [...current.sections, created]),
    )
    // 最初の記録なら、これが一覧カードに出る本文になる
    await syncBodyCopy(id)
  }

  function todayStatus(id: string): SaveStatus {
    return statusOf(todayKey(id))
  }

  // --- 個別の作業記録（当日の枠より上に出す、過去の記録） -------------------
  //
  // 既定では確定済みの見た目で出し、編集アイコンを押したときだけ書ける
  // （docs/03-functional-spec.md 3.2）。書き換えの扱いは当日の枠と同じ。

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
    // ここまで届いた、という印。これより古い取得の応答は当てない
    savedVersions.mark(sectionKey(id, updated.id), updated.updatedAt)

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
        savedVersions.forget(sectionKey(id, sectionId))
      },
    )

    // 本文の記録を消したら、次の記録が本文に繰り上がる
    if (wasPrimary) await syncBodyCopy(id)
  }

  return {
    byId,
    todayBodyOf,
    todayStatus,
    editTodayBody,
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
