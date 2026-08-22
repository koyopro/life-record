import type { DiaryDetailDto, DiarySummaryDto } from '~~/shared/types/diary'
import type { ItemDto } from '~~/shared/types/item'
import { excerptOf } from '~~/shared/utils/diary'
import { firstImageSrc } from '~~/shared/utils/scrapbox/parse'
import { IDLE_STATUS, type SaveStatus } from '~/utils/save-scheduler'
import type { LocalDiary } from '~/utils/offline/local-database'
import {
  allDiaries,
  getDiary,
  mergeServerDiary,
  mergeServerSectionsOnDate,
  sectionsOnDate,
} from '~/utils/offline/body-repository'
import { saveDiaryBody } from '~/utils/offline/body-actions'
import { requestFlush } from '~/utils/offline/flush-signal'
import { listOperations, type DiarySavePayload } from '~/utils/offline/sync-queue'
import { isNetworkError } from '~/utils/offline/sync-runner'

/**
 * 日記の置き場。
 *
 * useItemDetailStore と同じ形で、**クライアントでは IndexedDB が唯一の
 * 読み取り元**（docs/12-offline.md）。書いた内容はそこへ即座に入り、送信は
 * 列（SyncQueue）へ積むだけなので、オフラインでも書ける。
 *
 * 「この日にやったこと」も手元の作業記録から作る。サーバーの
 * `itemsWorkedOn`（server/utils/diaries.ts）と同じ規則で、同じ日付の
 * 作業記録を持つ Item を新しい順に並べる（docs/02-data-model.md 2.8）。
 */

/** 入力が落ち着くまで送信を待つ時間（useItemDetailStore と同じ）。 */
const FLUSH_DELAY_MS = 700

let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush() {
  if (!import.meta.client) return
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    requestFlush()
  }, FLUSH_DELAY_MS)
}

export function useDiaryStore() {
  /** 日付ごとの日記。IndexedDB から読んだもの。 */
  const diaries = useState<Record<string, LocalDiary>>('diary:local', () => ({}))
  /** 一度でも IndexedDB から読んだ日付。 */
  const loaded = useState<Record<string, boolean>>('diary:loaded', () => ({}))
  /** 送れていない日記の、直近の失敗（鍵は日付）。 */
  const errors = useState<Record<string, string>>('diary:errors', () => ({}))
  /**
   * その日に作業した Item。手元の作業記録（IndexedDB）から作る。
   * サーバー描画のときは、応答に入っているものをそのまま使う。
   */
  const workedOn = useState<Record<string, ItemDto[]>>('diary:worked-on', () => ({}))

  const itemStore = useItemStore()
  const { reachable } = useOnline()

  function byDate(date: string): LocalDiary | null {
    return diaries.value[date] ?? null
  }

  /** その日の控えを持っているか。持っていれば、一覧より控えを優先する。 */
  function knows(date: string): boolean {
    return Boolean(loaded.value[date])
  }

  function bodyOf(date: string): string {
    return byDate(date)?.body ?? ''
  }

  /**
   * 手元にある日記をまとめて読み込む（カレンダー用）。
   *
   * 一覧そのものはサーバーから取るが、オフラインでは返ってこない。
   * 手元にある日だけでも抜粋を出せるようにする。
   */
  async function loadAll(): Promise<void> {
    if (!import.meta.client) return
    const nextDiaries = { ...diaries.value }
    const nextLoaded = { ...loaded.value }
    for (const diary of await allDiaries()) {
      nextDiaries[diary.date] = diary
      nextLoaded[diary.date] = true
    }
    diaries.value = nextDiaries
    loaded.value = nextLoaded
  }

  /** IndexedDB から読み直す。ローカルへ書いたあとは必ずこれを呼ぶ。 */
  async function reload(date: string): Promise<void> {
    if (!import.meta.client) return
    const local = await getDiary(date)
    diaries.value = {
      ...diaries.value,
      [date]: local ?? { date, body: '', updatedAt: null, syncState: 'synced' },
    }
    loaded.value = { ...loaded.value, [date]: true }
    await refreshErrors()
  }

  /** 手元へ読み込んである日を、まとめて読み直す（送信が通ったあとなど）。 */
  async function reloadLoaded(): Promise<void> {
    for (const date of Object.keys(loaded.value)) {
      await reload(date)
      await loadWorkedOn(date)
    }
  }

  async function refreshErrors(): Promise<void> {
    const next: Record<string, string> = {}
    for (const operation of await listOperations()) {
      if (!operation.givenUp || operation.kind !== 'diary_save') continue
      const payload = operation.payload as DiarySavePayload
      next[payload.date] = operation.lastError ?? '送れていません'
    }
    errors.value = next
  }

  /**
   * サーバーから取り直し、ローカルへ重ねる。画面は setup で1度だけ呼ぶ。
   *
   * 取れなくても画面は成り立つ（IndexedDB にある分を出す）。
   */
  function track(date: Ref<string> | ComputedRef<string>) {
    const error = useState<string | null>('diary:fetch-error', () => null)

    /*
     * サーバー描画。IndexedDB が無いので、取った内容をそのまま状態へ入れる
     * （useState は payload でブラウザへ渡るので、最初の描画に本文が載る）。
     */
    if (import.meta.server) {
      const { data } = useFetch<DiaryDetailDto>(() => `/api/diaries/${date.value}`)
      watch(
        data,
        (value) => {
          if (!value) return
          diaries.value = {
            ...diaries.value,
            [date.value]: {
              date: date.value,
              body: value.body,
              updatedAt: value.updatedAt,
              syncState: 'synced',
            },
          }
          loaded.value = { ...loaded.value, [date.value]: true }
          workedOn.value = { ...workedOn.value, [date.value]: value.items }
        },
        { immediate: true },
      )
      return { error }
    }

    async function fetchOne(target: string): Promise<void> {
      await reload(target)
      await loadWorkedOn(target)

      try {
        const detail = await $fetch<DiaryDetailDto>(`/api/diaries/${target}`)
        await mergeServerDiary(
          target,
          { body: detail.body, updatedAt: detail.updatedAt },
          detail.fetchedAt ?? null,
        )
        /*
         * その日の作業記録も手元へ重ねる。「この日にやったこと」は手元の
         * 作業記録から作るので、これをしないと**他の端末で書いた分が出ない**
         * （この端末で詳細を開いたことのある Item しか手元に無いため）。
         */
        await mergeServerSectionsOnDate(target, detail.sections, detail.fetchedAt ?? null)

        // 他の端末で作られた TODO は、まだ手元の一覧に無いことがある
        if (detail.items.some((item) => !itemStore.byId(item.id))) {
          await itemStore.fetchFromServer()
        }

        await reload(target)
        await loadWorkedOn(target)
        error.value = null
        reachable.value = true
      } catch (e) {
        error.value = '最新の内容を取得できませんでした'
        if (isNetworkError(e)) reachable.value = false
      }
    }

    watch(date, (value) => void fetchOne(value), { immediate: true })

    /*
     * 画面から出ていくときは、待っているものを送っておく（書いたもの自体は
     * IndexedDB と列に残るので、送れなくても失われない）。
     * 戻ってきたときは取り直す。開いたままにしている間に、別の端末で
     * 書かれた分を拾うため。
     */
    const onLeaving = () => {
      if (document.visibilityState === 'hidden') requestFlush()
      else void fetchOne(unref(date))
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

  function statusOf(date: string): SaveStatus {
    const error = errors.value[date]
    if (error) return { state: 'error', error }

    const local = byDate(date)
    if (local && local.syncState !== 'synced') return { state: 'pending', error: null }

    return IDLE_STATUS
  }

  /**
   * 一覧（カレンダー）に出す1日分。控えを持っている日だけ返す。
   *
   * 一覧は `/api/diaries` から取るが、書いた直後はまだ古い内容が返る。
   * 書いた本人の手元には控えがあるので、そちらから同じ形を作って重ねる
   * （抜粋の作り方は API と同じ shared/utils/diary.ts を使う）。
   */
  function summaryOf(date: string): DiarySummaryDto | null {
    const diary = byDate(date)
    if (!diary) return null
    if (!diary.body.trim()) return null
    return {
      date,
      excerpt: excerptOf(diary.body),
      imageSrc: firstImageSrc(diary.body),
    }
  }

  /**
   * 本文を書き換える。手元の状態はその場で進め、IndexedDB と列は追いかけで
   * 更新する（読み直すと、書き込みが終わるまで1つ前の内容へ戻って見える）。
   */
  async function editBody(date: string, value: string): Promise<void> {
    const local = byDate(date)
    diaries.value = {
      ...diaries.value,
      [date]: {
        date,
        body: value,
        updatedAt: local?.updatedAt ?? null,
        syncState: 'pending_save',
      },
    }

    await saveDiaryBody(date, value)
    scheduleFlush()
  }

  /** 待たずに今すぐ送る。別の日へ移るときに呼ぶ。 */
  function flush(): void {
    requestFlush()
  }

  // --- この日にやったこと ---------------------------------------------------

  async function loadWorkedOn(date: string): Promise<void> {
    if (!import.meta.client) return
    const ids = new Set(
      (await sectionsOnDate(date))
        .filter((section) => section.syncState !== 'pending_delete')
        .map((section) => section.itemId),
    )

    const found = itemStore.items.value
      .filter((item) => ids.has(item.id) && item.syncState !== 'pending_delete')
      // サーバー（server/utils/diaries.ts）と同じく、更新の新しい順
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))

    workedOn.value = { ...workedOn.value, [date]: found }
  }

  function workedOnOf(date: string): ItemDto[] {
    return workedOn.value[date] ?? []
  }

  return {
    byDate,
    bodyOf,
    knows,
    summaryOf,
    statusOf,
    editBody,
    flush,
    loadAll,
    loadWorkedOn,
    workedOnOf,
    reload,
    reloadLoaded,
    track,
  }
}
