import type { DiaryDetailDto, DiaryDto, DiarySummaryDto } from '~~/shared/types/diary'
import { excerptOf } from '~~/shared/utils/diary'
import { firstImageSrc } from '~~/shared/utils/scrapbox/parse'
import {
  createSaveScheduler,
  IDLE_STATUS,
  type SaveStatus,
} from '~/utils/save-scheduler'
import { createSavedVersions } from '~/utils/saved-versions'

/**
 * 日記の置き場。
 *
 * Item 詳細（useItemDetailStore）と同じ形で、**画面が読むのはこの控えだけ**に
 * する。編集はローカルへ即座に反映し、送信は裏で遅らせて行うので、書いてから
 * 別の日へ移って戻っても編集前の本文は出ない（docs/15-client-state.md）。
 */

/** 遅延送信は画面より長生きするのでモジュールに置く（useItemDetailStore と同じ）。 */
let statusStore: Ref<Record<string, SaveStatus>> | null = null

const scheduler = createSaveScheduler({
  onStatus: (key, status) => {
    if (!statusStore) return
    statusStore.value = { ...statusStore.value, [key]: status }
  },
})

/** 保存できた版（サーバーが返した更新日時）の控え（useItemDetailStore と同じ）。 */
const savedVersions = createSavedVersions()

export function useDiaryStore() {
  const { cache, set } = usePersistedRecordCache<DiaryDetailDto>('diary-detail-cache')
  const statuses = useState<Record<string, SaveStatus>>('diary-save', () => ({}))
  if (import.meta.client) statusStore = statuses

  /** 画面が読む日記。取得が終わっていなくても、控えがあれば出せる。 */
  function byDate(date: string): DiaryDetailDto | null {
    return cache.value[date] ?? null
  }

  /** その日の控えを持っているか。持っていれば、一覧より控えを優先する。 */
  function knows(date: string): boolean {
    return date in cache.value
  }

  function statusOf(date: string): SaveStatus {
    return statuses.value[date] ?? IDLE_STATUS
  }

  /**
   * その日の本文は、サーバーから届いた内容より手元の方が新しいか。
   *
   * 判断は useItemDetailStore.localIsNewer と同じ。
   *
   * 1. まだ送れていない・送信中（`busy`）
   * 2. 送ったが失敗した（`error`）。送れていない以上、手元にしか無い
   * 3. 送れているが、届いた内容の更新日時がこちらの保存より古い
   *    （＝保存より前に出した取得の応答が、保存の後で届いた）
   */
  function localIsNewer(date: string, serverUpdatedAt: string | null): boolean {
    if (scheduler.busy(date)) return true
    if (statusOf(date).state === 'error') return true
    return savedVersions.isStale(date, serverUpdatedAt)
  }

  /**
   * サーバーから取り直し、控えへ重ねる。画面は setup で1度だけ呼ぶ。
   *
   * **手元の方が新しい本文だけはローカルを残す**（`localIsNewer`）。
   * 「この日にやったこと」はサーバーが正なので、書いている最中でも
   * そのまま採る（useItemDetailStore.track と同じ規則）。
   */
  function track(date: Ref<string> | ComputedRef<string>) {
    const { data, error } = useFetch<DiaryDetailDto>(
      () => `/api/diaries/${date.value}`,
    )

    watch(
      data,
      (value) => {
        if (!value) return
        const key = date.value
        if (!localIsNewer(key, value.updatedAt)) {
          set(key, value)
          return
        }
        const body = bodyOf(key)
        set(key, {
          ...value,
          body,
          exists: body.trim().length > 0,
          // 本文は手元のものを残すので、更新日時も手元のものに合わせる
          updatedAt: byDate(key)?.updatedAt ?? value.updatedAt,
        })
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

  function bodyOf(date: string): string {
    return byDate(date)?.body ?? ''
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

  /** 本文を書き換える。控えへ即座に反映し、送信は遅らせて裏で行う。 */
  function editBody(date: string, value: string) {
    const current = byDate(date)
    set(date, {
      date,
      body: value,
      // 空にすればサーバー側では消える。書けば、その時点で「ある」扱い
      exists: value.trim().length > 0,
      updatedAt: current?.updatedAt ?? null,
      items: current?.items ?? [],
    })

    // 応答の本文は控えへ当てない。送った時点の本文しか載っておらず、往復中に
    // 書き足された分を戻してしまう。控えには既に最新が入っている。
    // 更新日時だけは受け取り、これより古い取得の応答を退ける材料にする
    scheduler.schedule(date, async () => {
      const saved = await $fetch<DiaryDto>(`/api/diaries/${date}`, {
        method: 'PUT',
        body: { body: value },
      })
      savedVersions.mark(date, saved.updatedAt)
    })
  }

  /** 待たずに今すぐ送る。別の日へ移るときに呼ぶ。 */
  function flush(date: string): Promise<void> {
    return scheduler.flush(date)
  }

  return {
    byDate,
    bodyOf,
    knows,
    summaryOf,
    statusOf,
    editBody,
    flush,
    flushAll: () => scheduler.flushAll(),
    track,
  }
}
