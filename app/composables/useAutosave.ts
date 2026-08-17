export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

interface Options<T> {
  /** 監視する値。変化するたびに保存する。 */
  source: Ref<T>
  /** 実際の保存処理。 */
  save: (value: T) => Promise<void>
  /** 入力が落ち着くまで待つ時間。 */
  delay?: number
  /** 保存対象かどうか。false を返す間は保存しない。 */
  enabled?: () => boolean
}

const SAVED_INDICATOR_MS = 1500

/**
 * 入力をボタンなしで保存する。
 *
 * 打鍵のたびに送ると無駄が多いので、入力が止まってから保存する。
 * 保存前に画面を離れる場合に取りこぼさないよう、flush を用意する。
 */
export function useAutosave<T>(options: Options<T>) {
  const { source, save, delay = 700 } = options

  const state = ref<SaveState>('idle')
  const errorMessage = ref<string | null>(null)

  let timer: ReturnType<typeof setTimeout> | undefined
  /** 直近で保存に成功した値。同じ内容を送り直さないために持つ。 */
  let lastSaved: T = source.value
  let inFlight: Promise<void> | null = null
  let savedIndicatorTimer: ReturnType<typeof setTimeout> | undefined

  function markSynced() {
    lastSaved = source.value
  }

  async function run() {
    if (options.enabled && !options.enabled()) return

    const value = source.value
    if (value === lastSaved) return

    // 前の保存が終わってから次を送る。順序が入れ替わらないようにするため。
    if (inFlight) await inFlight.catch(() => {})

    state.value = 'saving'
    errorMessage.value = null

    inFlight = (async () => {
      try {
        await save(value)
        lastSaved = value
        // 保存中に更に入力されていたら、続けてもう一度保存する
        if (source.value !== value) {
          inFlight = null
          await run()
          return
        }
        state.value = 'saved'
        clearTimeout(savedIndicatorTimer)
        savedIndicatorTimer = setTimeout(() => {
          if (state.value === 'saved') state.value = 'idle'
        }, SAVED_INDICATOR_MS)
      } catch (e) {
        state.value = 'error'
        errorMessage.value = extractSaveError(e)
      } finally {
        inFlight = null
      }
    })()

    await inFlight
  }

  /** 待たずに今すぐ保存する。画面を離れるときなどに使う。 */
  async function flush() {
    clearTimeout(timer)
    await run()
  }

  watch(source, () => {
    if (source.value === lastSaved) return
    state.value = 'pending'
    clearTimeout(timer)
    timer = setTimeout(() => void run(), delay)
  })

  // タブを閉じる・バックグラウンドへ回るときの取りこぼしを防ぐ
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') void flush()
  }

  onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    clearTimeout(savedIndicatorTimer)
    void flush()
  })

  return { state, errorMessage, flush, markSynced }
}

export const SAVE_STATE_LABELS: Record<SaveState, string> = {
  idle: '',
  pending: '未保存',
  saving: '保存中…',
  saved: '保存しました',
  error: '保存に失敗しました',
}

function extractSaveError(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const data = (e as { data?: { statusMessage?: string } }).data
    if (data?.statusMessage) return data.statusMessage
  }
  return '保存に失敗しました'
}
