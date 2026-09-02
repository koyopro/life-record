import type { ItemDetailDto, SectionDto } from '~~/shared/types/item'
import type { Fetched } from '~~/shared/types/fetched'
import {
  nextPositionIn,
  pickPrimarySection,
  pickTodaySection,
  sortSectionsForDisplay,
} from '~/utils/section-order'
import { IDLE_STATUS, type SaveStatus } from '~/utils/save-scheduler'
import type { LocalSection } from '~/utils/offline/local-database'
import {
  mergeServerSections,
  sectionsOfItem,
  toLocalSection,
} from '~/utils/offline/body-repository'
import {
  removeSectionLocally,
  reorderSectionsLocally,
  saveSectionBody,
} from '~/utils/offline/body-actions'
import { requestFlush } from '~/utils/offline/flush-signal'
import { listOperations, type SectionSavePayload } from '~/utils/offline/sync-queue'
import { isNetworkError, REQUEST_TIMEOUT_MS } from '~/utils/offline/sync-runner'

/**
 * Item の詳細（作業記録＝Section）の置き場。
 *
 * TODO のメタデータ（useItemStore）と同じく、**クライアントでは IndexedDB が
 * 唯一の読み取り元**にする（docs/12-offline.md）。サーバーから取った内容も
 * いったんそこへ書いてから読み直すので、オンラインでもオフラインでも
 * 画面の作りが変わらない。
 *
 * - 編集はローカル（IndexedDB）へ即座に反映し、送信は列（SyncQueue）へ積む
 * - 打鍵のたびには送らない。入力が落ち着いてから列を流す（`FLUSH_DELAY_MS`）
 * - サーバーから取り直した内容の重ね方（未送信を上書きしない）は
 *   body-repository が持つ
 */

/**
 * 入力が落ち着くまで送信を待つ時間。
 *
 * ローカルへの反映は打鍵のたびに行うので、遅らせるのは送信だけ
 * （docs/15-client-state.md 14.2 の 3）。
 */
const FLUSH_DELAY_MS = 700

/** 画面より長生きさせる。行を移っても、送信の予約は残す。 */
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush() {
  if (!import.meta.client) return
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    requestFlush()
  }, FLUSH_DELAY_MS)
}

export function useItemDetailStore() {
  /** Item ごとの作業記録。IndexedDB から読んだもの。 */
  const sections = useState<Record<string, LocalSection[]>>(
    'detail:sections',
    () => ({}),
  )
  /** 一度でも IndexedDB から読んだ Item。まだ何も出せない状態と区別する。 */
  const loaded = useState<Record<string, boolean>>('detail:loaded', () => ({}))
  /** 送れていない作業記録の、直近の失敗（鍵は Section の id）。 */
  const errors = useState<Record<string, string>>('detail:errors', () => ({}))

  const itemStore = useItemStore()
  const { reachable } = useOnline()

  /** 画面が読む作業記録。表示順（日付の古い順）に並べて返す。 */
  function sectionsOf(id: string): SectionDto[] {
    return sortSectionsForDisplay(visible(sections.value[id] ?? []))
  }

  /** その Item の記録を、一度でも手元へ読み込んだか。 */
  function knows(id: string): boolean {
    return Boolean(loaded.value[id])
  }

  /** 消す途中の記録は出さない（送信が通るまでは取り消せるように残してある）。 */
  function visible(list: LocalSection[]): LocalSection[] {
    return list.filter((section) => section.syncState !== 'pending_delete')
  }

  /** IndexedDB から読み直す。記録の増減があったあとに呼ぶ。 */
  async function reload(id: string): Promise<void> {
    if (!import.meta.client) return
    const loadedSections = await sectionsOfItem(id)
    sections.value = {
      ...sections.value,
      [id]: keepUnsent(sections.value[id] ?? [], loadedSections),
    }
    loaded.value = { ...loaded.value, [id]: true }
    await refreshErrors()
  }

  /**
   * 読み直した内容を当てるとき、**まだ送れていない記録は手元の状態を残す**。
   *
   * 打鍵は「状態を先に進めてから IndexedDB へ書く」（`applyLocal` → `write`）。
   * 書き終わる前に読み直すと1つ前の内容が返るので、そのまま当てると入力欄が
   * 一瞬だけ前の状態へ戻る。日本語入力では、その1回で変換が打ち切られる
   * （書いている途中に勝手に確定する）。
   *
   * 送れていない記録は、この端末で書いた分がそのまま残っているもの。手元の
   * 状態が IndexedDB より古くなることはない（先に進めてから書くため）ので、
   * **中身が食い違っていれば**手元を採る。
   *
   * 中身が同じなら読み直した側を採る。送り終えた印（`synced`）を受け取れないと、
   * いつまでも「未同期」のままになるため。
   */
  function keepUnsent(
    current: LocalSection[],
    loadedSections: LocalSection[],
  ): LocalSection[] {
    if (current.length === 0) return loadedSections

    const mine = new Map(current.map((section) => [section.id, section]))
    return loadedSections.map((section) => {
      const local = mine.get(section.id)
      if (!local || local.syncState === 'synced') return section

      const changed = local.body !== section.body || local.date !== section.date
      return changed ? local : section
    })
  }

  /** 手元へ読み込んである Item を、まとめて読み直す（送信が通ったあとなど）。 */
  async function reloadLoaded(): Promise<void> {
    for (const id of Object.keys(loaded.value)) await reload(id)
  }

  /**
   * 手元の状態をその場で進める。
   *
   * 打鍵は IndexedDB への書き込みより速い。書き終わるのを待ってから状態を
   * 更新すると、次の一文字が「その日の記録はまだ無い」と判断して**別の記録を
   * 作ってしまう**。書き込みは追いかけで行い、状態はここで先に進める。
   */
  function applyLocal(id: string, section: LocalSection): void {
    const list = sections.value[id] ?? []
    const next = list.some((s) => s.id === section.id)
      ? list.map((s) => (s.id === section.id ? section : s))
      : [...list, section]
    sections.value = { ...sections.value, [id]: next }
  }

  /**
   * 送れていない記録の失敗を拾い直す。
   *
   * 自動での送り直しを諦めた操作だけを見る。一時的な失敗は送り直しに
   * 任せるので、画面には出さない。
   */
  async function refreshErrors(): Promise<void> {
    const next: Record<string, string> = {}
    for (const operation of await listOperations()) {
      if (!operation.givenUp || operation.kind !== 'section_save') continue
      const payload = operation.payload as SectionSavePayload
      next[payload.id] = operation.lastError ?? '送れていません'
    }
    errors.value = next
  }

  /**
   * サーバーから取り直し、ローカルへ重ねる。画面は setup で1度だけ呼ぶ。
   *
   * 取れなくても画面は成り立つ（IndexedDB にある分を出す）ので、
   * 失敗は「取り直せなかった」という知らせにとどめる。
   */
  function track(id: Ref<string> | ComputedRef<string>) {
    const error = useState<string | null>('detail:fetch-error', () => null)

    /*
     * サーバー描画。ここには IndexedDB が無いので、取った内容をそのまま
     * 状態へ入れる（useState は payload でブラウザへ渡るので、最初の描画に
     * 本文が載る）。ブラウザ側では、すぐ IndexedDB の内容で置き換わる。
     */
    if (import.meta.server) {
      const { data } = useFetch<Fetched<ItemDetailDto>>(
        () => `/api/items/${id.value}`,
      )
      watch(
        data,
        (value) => {
          if (!value) return
          sections.value = {
            ...sections.value,
            [id.value]: value.data.sections.map((section) =>
              toLocalSection(id.value, section),
            ),
          }
          loaded.value = { ...loaded.value, [id.value]: true }
        },
        { immediate: true },
      )
      return { error }
    }

    async function fetchOne(target: string): Promise<void> {
      await reload(target)

      try {
        const detail = await $fetch<Fetched<ItemDetailDto>>(`/api/items/${target}`, {
          timeout: REQUEST_TIMEOUT_MS,
        })
        await mergeServerSections(target, detail.data.sections, detail.fetchedAt)
        await reload(target)
        error.value = null
        reachable.value = true
      } catch (e) {
        error.value = '最新の内容を取得できませんでした'
        if (isNetworkError(e)) reachable.value = false
      }
    }

    watch(id, (value) => void fetchOne(value), { immediate: true })

    /*
     * 画面から出ていくときに、待っているものを送っておく。
     *
     * 書いたものは IndexedDB と列に残るので、送る前にページごと消えても
     * 失われない（次に開いたときに送られる）。ここで流すのは、
     * すぐに反映させたいときのため。
     *
     * 戻ってきたときは取り直す。開いたままにしている間に、別の端末で
     * 書かれた分を拾うため。
     */
    const onLeaving = () => {
      if (document.visibilityState === 'hidden') requestFlush()
      else void fetchOne(unref(id))
    }
    const onPageHide = () => requestFlush()

    onMounted(() => {
      document.addEventListener('visibilitychange', onLeaving)
      window.addEventListener('pagehide', onPageHide)
    })
    onBeforeUnmount(() => {
      document.removeEventListener('visibilitychange', onLeaving)
      window.removeEventListener('pagehide', onPageHide)
    })

    return { error }
  }

  // --- 保存の状態 ---------------------------------------------------------

  function statusOfSection(id: string, sectionId: string | null): SaveStatus {
    if (!sectionId) return IDLE_STATUS

    const error = errors.value[sectionId]
    if (error) return { state: 'error', error }

    const local = (sections.value[id] ?? []).find((s) => s.id === sectionId)
    if (local && local.syncState !== 'synced') return { state: 'pending', error: null }

    return IDLE_STATUS
  }

  // --- 一覧カードに出す本文の写し -------------------------------------------

  /**
   * 一覧カードに出す本文の写し（`ItemDto.body`）を揃える。
   *
   * 写しが指すのは**最初に作られた記録**（docs/02-data-model.md 2.4）。
   * サーバーにも同じ規則があるので、こちらで計算して入れておけば、
   * 取り直したときに食い違わない。
   */
  async function syncBodyCopy(id: string): Promise<void> {
    const primary = pickPrimarySection(visible(sections.value[id] ?? []))
    await itemStore.setBodyCopy(id, primary?.body ?? null)
  }

  /** 手元の状態から、同期状態つきの1件を引く（表示用の sectionsOf とは別）。 */
  function localSection(id: string, sectionId: string | undefined): LocalSection | null {
    if (!sectionId) return null
    return (sections.value[id] ?? []).find((s) => s.id === sectionId) ?? null
  }

  /**
   * 本文を1件書く。状態をその場で進め、IndexedDB と列は追いかけで更新する。
   *
   * 記録の増減が無いので読み直さない。読み直すと、書き込みが終わるまでの
   * 一瞬だけ1つ前の内容へ戻って見える。
   */
  async function write(id: string, section: LocalSection): Promise<void> {
    applyLocal(id, section)

    await saveSectionBody({
      id: section.id,
      itemId: id,
      date: section.date,
      body: section.body,
      position: section.position,
    })
    await syncBodyCopy(id)
    scheduleFlush()
  }

  /** 記録の増減をともなう操作のあとの後始末。 */
  async function afterEdit(id: string): Promise<void> {
    await reload(id)
    await syncBodyCopy(id)
    scheduleFlush()
  }

  // --- 当日の枠（既定で編集している作業記録） -----------------------------
  //
  // Item は本文を持たないため、画面が「本文」として出している枠は
  // **その日の作業記録**（date が当日の Section）として保存する
  // （docs/03-functional-spec.md 3.2）。日をまたいで書き足しても、
  // 前の日の記録は前の日のものとして残る。

  function todaySectionOf(id: string, today: string): SectionDto | null {
    return pickTodaySection(sectionsOf(id), today)
  }

  /**
   * 当日の枠に出す内容。
   *
   * まだ手元へ読み込んでいないことを `null` で表し、「その日の記録が空」と
   * 区別する。一緒にしてしまうと、消している最中に古い写しへ戻って見える。
   */
  function todayBodyOf(id: string, today: string): string | null {
    if (!knows(id)) return null
    return todaySectionOf(id, today)?.body ?? ''
  }

  /**
   * 当日の枠を書き換える。ローカルへ即座に反映し、送信は列へ積む。
   *
   * その日の記録がまだ無ければ作る。ただし**何か書かれるまでは作らない**。
   * 空の記録を先に作ると、開いただけの日が記録として残ってしまう。
   */
  async function editTodayBody(
    id: string,
    today: string,
    value: string,
  ): Promise<void> {
    const section = localSection(id, todaySectionOf(id, today)?.id)
    if (!section && !value.trim()) return

    const stamp = new Date().toISOString()
    const next: LocalSection = section
      ? { ...section, body: value, updatedAt: stamp, syncState: 'pending_save' }
      : {
          id: crypto.randomUUID(),
          itemId: id,
          date: today,
          body: value,
          position: nextPositionIn(sectionsOf(id), today),
          // 日記でのピン留め（3.3）は日記の画面から立てる。作った時点では付かない
          pinned: false,
          createdAt: stamp,
          updatedAt: stamp,
          syncState: 'pending_save',
        }

    await write(id, next)
  }

  function todayStatus(id: string, today: string): SaveStatus {
    return statusOfSection(id, todaySectionOf(id, today)?.id ?? null)
  }

  // --- 個別の作業記録（当日の枠より上に出す、過去の記録） -------------------

  function sectionBodyOf(id: string, sectionId: string): string {
    return sectionsOf(id).find((s) => s.id === sectionId)?.body ?? ''
  }

  async function editSectionBody(
    id: string,
    sectionId: string,
    value: string,
  ): Promise<void> {
    const section = localSection(id, sectionId)
    if (!section) return

    await write(id, {
      ...section,
      body: value,
      updatedAt: new Date().toISOString(),
      syncState: 'pending_save',
    })
  }

  function sectionStatus(id: string, sectionId: string): SaveStatus {
    return statusOfSection(id, sectionId)
  }

  // --- 記録そのものの操作 ---------------------------------------------------

  /**
   * その日付の記録を引く。**1つのタスクの記録は、同じ日に1件だけ**
   * （docs/03-functional-spec.md 3.2）。
   *
   * 別の端末で同じ日に書かれた分など、すでに複数ある場合は最後の1件を返す
   * （当日の枠の決め方と同じ）。
   */
  function sectionOnDate(
    id: string,
    date: string,
    exceptId?: string,
  ): SectionDto | null {
    return pickTodaySection(
      sectionsOf(id).filter((section) => section.id !== exceptId),
      date,
    )
  }

  /**
   * 記録を別の記録へまとめる。
   *
   * すでに記録のある日へ日付を移したときに使う。同じ日に2件は作らないが、
   * 書いたものは捨てないので、本文を続けて書き足してから元の記録を消す。
   */
  async function mergeSections(
    id: string,
    fromId: string,
    toId: string,
  ): Promise<void> {
    const from = sectionsOf(id).find((s) => s.id === fromId)
    const to = sectionsOf(id).find((s) => s.id === toId)
    if (!from || !to) return

    const body = [to.body.trimEnd(), from.body.trim()].filter(Boolean).join('\n')
    await editSectionBody(id, toId, body)
    await removeSection(id, fromId)
  }

  /** 作業記録を1件足す。足した記録を返す。 */
  async function addSection(id: string, date: string): Promise<SectionDto> {
    const created: SectionDto = {
      id: crypto.randomUUID(),
      date,
      body: '',
      position: nextPositionIn(sectionsOf(id), date),
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await saveSectionBody({ id: created.id, itemId: id, date, body: '' })
    await afterEdit(id)
    return created
  }

  /** 記録の日付を変える。移った先の末尾に置かれる（サーバーと同じ規則）。 */
  async function changeSectionDate(
    id: string,
    sectionId: string,
    date: string,
  ): Promise<void> {
    const section = sectionsOf(id).find((s) => s.id === sectionId)
    if (!section) return

    await saveSectionBody({ id: sectionId, itemId: id, date, body: section.body })
    await afterEdit(id)
  }

  async function reorderSections(id: string, ids: string[]): Promise<void> {
    await reorderSectionsLocally(id, ids)
    await afterEdit(id)
  }

  async function removeSection(id: string, sectionId: string): Promise<void> {
    await removeSectionLocally(sectionId, id)
    await afterEdit(id)
  }

  return {
    sectionsOf,
    knows,
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
    sectionOnDate,
    mergeSections,
    reload,
    reloadLoaded,
    track,
  }
}
