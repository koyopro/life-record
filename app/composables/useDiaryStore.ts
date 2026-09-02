import type { DiaryDetailDto, DiarySectionDto, DiarySummaryDto } from '~~/shared/types/diary'
import type { Fetched } from '~~/shared/types/fetched'
import type { ItemDto } from '~~/shared/types/item'
import type { WorkedOnRecord } from '~/utils/diary-worked-on'
import { excerptOf, pinnedImageOf } from '~~/shared/utils/diary'
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
import { saveDiaryBody, setSectionPinned } from '~/utils/offline/body-actions'
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

/** 1つの Item について、その日の記録をまとめたもの。 */
interface DayRecord {
  body: string
  /** どれか1つでもピンが立っていれば、その日の記録はピン留め。 */
  pinned: boolean
  /** 元になった作業記録の id。ピンの付け外しの宛先。 */
  sectionIds: string[]
}

/**
 * その日の作業記録を Item ごとにまとめる。
 *
 * 同じ日に複数の記録がある Item（別の端末で書かれた分など。
 * docs/03-functional-spec.md 3.2）は、続けてつなぐ。日記に出る「作業記録」は
 * この**まとめたもの1件**なので、ピンもまとめた単位で持つ（付け外しは
 * 元になった記録すべてに当てる）。
 */
function recordsByItem(
  sections: { id: string; itemId: string; body: string; pinned?: boolean }[],
): Map<string, DayRecord> {
  const found = new Map<string, { bodies: string[]; pinned: boolean; sectionIds: string[] }>()

  for (const section of sections) {
    const current = found.get(section.itemId) ?? {
      bodies: [],
      pinned: false,
      sectionIds: [],
    }
    current.bodies.push(section.body)
    current.pinned = current.pinned || section.pinned === true
    current.sectionIds.push(section.id)
    found.set(section.itemId, current)
  }

  return new Map(
    [...found.entries()].map(([itemId, entry]) => [
      itemId,
      {
        body: entry.bodies.map((body) => body.trim()).filter(Boolean).join('\n'),
        pinned: entry.pinned,
        sectionIds: entry.sectionIds,
      },
    ]),
  )
}

/** その日の記録が無い Item のための空の値。 */
const EMPTY_RECORD: DayRecord = { body: '', pinned: false, sectionIds: [] }

/** サーバーの応答（Item と作業記録）から、画面に出す形を作る。 */
function toRecords(
  items: ItemDto[],
  sections: DiarySectionDto[],
): WorkedOnRecord[] {
  const records = recordsByItem(sections)
  return items.map((item) => ({ item, ...(records.get(item.id) ?? EMPTY_RECORD) }))
}

export function useDiaryStore() {
  /** 日付ごとの日記。IndexedDB から読んだもの。 */
  const diaries = useState<Record<string, LocalDiary>>('diary:local', () => ({}))
  /** 一度でも IndexedDB から読んだ日付。 */
  const loaded = useState<Record<string, boolean>>('diary:loaded', () => ({}))
  /** 送れていない日記の、直近の失敗（鍵は日付）。 */
  const errors = useState<Record<string, string>>('diary:errors', () => ({}))
  /**
   * その日にやったこと（Item と、その日の作業記録の本文）。
   * 手元の作業記録（IndexedDB）から作る。サーバー描画のときは応答から作る。
   */
  const workedOn = useState<Record<string, WorkedOnRecord[]>>(
    'diary:worked-on',
    () => ({}),
  )

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

  /**
   * IndexedDB から読み直す。ローカルへ書いたあとは必ずこれを呼ぶ。
   *
   * ただし**まだ送れていない日は、手元の状態を残す**。打鍵は「状態を先に
   * 進めてから IndexedDB へ書く」（`editBody`）ので、書き終わる前に読み直すと
   * 1つ前の内容が返る。当ててしまうと入力欄が一瞬だけ前の状態へ戻り、
   * 日本語入力ではその1回で変換が打ち切られる（勝手に確定する）。
   */
  async function reload(date: string): Promise<void> {
    if (!import.meta.client) return

    const loadedDiary = (await getDiary(date)) ?? {
      date,
      body: '',
      updatedAt: null as string | null,
      syncState: 'synced' as const,
    }

    /*
     * 中身が同じなら読み直した側を採る。送り終えた印（`synced`）を
     * 受け取れないと、いつまでも「未同期」のままになる。
     */
    const mine = diaries.value[date]
    const keepMine =
      mine && mine.syncState !== 'synced' && mine.body !== loadedDiary.body

    diaries.value = {
      ...diaries.value,
      [date]: keepMine ? mine : loadedDiary,
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
      const { data } = useFetch<Fetched<DiaryDetailDto>>(
        () => `/api/diaries/${date.value}`,
      )
      watch(
        data,
        (value) => {
          if (!value) return
          const detail = value.data
          diaries.value = {
            ...diaries.value,
            [date.value]: {
              date: date.value,
              body: detail.body,
              updatedAt: detail.updatedAt,
              syncState: 'synced',
            },
          }
          loaded.value = { ...loaded.value, [date.value]: true }
          workedOn.value = {
            ...workedOn.value,
            [date.value]: toRecords(detail.items, detail.sections),
          }
        },
        { immediate: true },
      )
      return { error }
    }

    async function fetchOne(target: string): Promise<void> {
      await reload(target)
      await loadWorkedOn(target)

      try {
        const { fetchedAt, data: detail } = await $fetch<Fetched<DiaryDetailDto>>(
          `/api/diaries/${target}`,
        )
        await mergeServerDiary(
          target,
          { body: detail.body, updatedAt: detail.updatedAt },
          fetchedAt,
        )
        /*
         * その日の作業記録も手元へ重ねる。「この日にやったこと」は手元の
         * 作業記録から作るので、これをしないと**他の端末で書いた分が出ない**
         * （この端末で詳細を開いたことのある Item しか手元に無いため）。
         */
        await mergeServerSectionsOnDate(target, detail.sections, fetchedAt)

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
    /*
     * ピン留めした作業記録の画像。カレンダーのサムネイルは
     * 「本文の画像 → ピン留めの画像」の順に使う（docs/03-functional-spec.md 3.3）。
     * その日の作業記録を手元に持っていない（開いたことがない）日は null で、
     * 画面側がサーバーの答えで補う。
     */
    const pinnedImageSrc = pinnedImageOf(
      workedOnOf(date)
        .filter((record) => record.pinned)
        .map((record) => record.body),
    )

    if (!diary) return null
    // 本文を空にした日でも、ピン留めの画像があればその日の目印として残す
    if (!diary.body.trim()) {
      return pinnedImageSrc
        ? { date, excerpt: '', imageSrc: null, pinnedImageSrc }
        : null
    }

    return {
      date,
      excerpt: excerptOf(diary.body),
      imageSrc: firstImageSrc(diary.body),
      pinnedImageSrc,
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

    const records = recordsByItem(
      (await sectionsOnDate(date)).filter(
        (section) => section.syncState !== 'pending_delete',
      ),
    )

    const found = itemStore.items.value
      .filter((item) => records.has(item.id) && item.syncState !== 'pending_delete')
      // サーバー（server/utils/diaries.ts）と同じく、更新の新しい順
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((item) => ({
        item: item as ItemDto,
        ...(records.get(item.id) ?? EMPTY_RECORD),
      }))

    workedOn.value = { ...workedOn.value, [date]: found }
  }

  /**
   * 作業記録のピンを付け外しする（docs/03-functional-spec.md 3.3）。
   *
   * 手元（IndexedDB）へ先に書き、送信は列に積むだけ。オフラインでも留められ、
   * 繋がったときに送られる。DB へ入るので、別のブラウザでも同じ並びで出る。
   *
   * 同じ日に複数の記録がある Item は、まとめて1件として出しているので、
   * 元になった記録すべてに同じ値を当てる。
   */
  async function setPinned(
    date: string,
    sectionIds: string[],
    pinned: boolean,
  ): Promise<void> {
    for (const id of sectionIds) await setSectionPinned(id, pinned)
    await loadWorkedOn(date)
    scheduleFlush()
  }

  function workedOnOf(date: string): WorkedOnRecord[] {
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
    setPinned,
    reload,
    reloadLoaded,
    track,
  }
}
