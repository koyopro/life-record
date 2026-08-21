/**
 * 「入力が止まったら送る」を、鍵ごとに1本ずつ持つ仕組み。
 *
 * 画面（コンポーネント）ではなくストアの側に置く。編集した値の反映は
 * ローカルへ即座に行い、サーバーへの送信だけをここで遅らせるため、
 * 送る前に画面を離れても送信は続く（docs/15-client-state.md）。
 *
 * Vue に依存させない。ここが「いつ送るか」の決まりごとの本体で、
 * 単体でも試せるようにしておきたいため（sync-engine と同じ考え方）。
 */

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface SaveStatus {
  state: SaveState
  /** `error` のときだけ入る。画面にそのまま出す。 */
  error: string | null
}

export const IDLE_STATUS: SaveStatus = { state: 'idle', error: null }

/** 入力が落ち着くまで待つ時間。 */
const DEFAULT_DELAY_MS = 700

/** 「保存しました」を出しておく時間。 */
const SAVED_INDICATOR_MS = 1500

export interface SaveSchedulerOptions {
  delay?: number
  savedIndicatorMs?: number
  /** 状態が変わった。画面に見せる値へ写す。 */
  onStatus: (key: string, status: SaveStatus) => void
}

interface Slot {
  /** 待っている仕事。同じ鍵では最新の1つだけを持つ（途中の値は送らない）。 */
  next: (() => Promise<void>) | null
  /** 送信中の仕事。終わるまで次を始めない（順序が入れ替わらないように）。 */
  running: Promise<void> | null
  timer: ReturnType<typeof setTimeout> | null
  savedTimer: ReturnType<typeof setTimeout> | null
}

export interface SaveScheduler {
  /** 鍵に対する保存を予約する。同じ鍵の予約は最新のものだけが残る。 */
  schedule(key: string, run: () => Promise<void>): void
  /** 待たずに今すぐ送る。送り終わるまで待てる。 */
  flush(key: string): Promise<void>
  /** 予約されているものをすべて送る。画面を閉じるときなどに使う。 */
  flushAll(): Promise<void>
  /** その鍵に、まだ送れていない／送信中の保存があるか。 */
  busy(key: string): boolean
  /** まだ送れていない／送信中の鍵。 */
  busyKeys(): string[]
}

export function createSaveScheduler(options: SaveSchedulerOptions): SaveScheduler {
  const delay = options.delay ?? DEFAULT_DELAY_MS
  const savedIndicatorMs = options.savedIndicatorMs ?? SAVED_INDICATOR_MS
  const slots = new Map<string, Slot>()

  function slotOf(key: string): Slot {
    let slot = slots.get(key)
    if (!slot) {
      slot = { next: null, running: null, timer: null, savedTimer: null }
      slots.set(key, slot)
    }
    return slot
  }

  function setStatus(key: string, status: SaveStatus) {
    options.onStatus(key, status)
  }

  function markSaved(key: string, slot: Slot) {
    setStatus(key, { state: 'saved', error: null })
    if (slot.savedTimer) clearTimeout(slot.savedTimer)
    slot.savedTimer = setTimeout(() => {
      slot.savedTimer = null
      // 待っている間に次の編集が来ていたら、そちらの状態を消さない
      if (!slot.next && !slot.running) setStatus(key, IDLE_STATUS)
    }, savedIndicatorMs)
  }

  /**
   * 待っているものを送り切る。
   *
   * 送信中にさらに編集されていたら、続けてもう一度送る。同じ鍵で並行に
   * 投げると、後から送った古い値が最後に届いてしまうため。
   */
  function drain(key: string): Promise<void> {
    const slot = slots.get(key)
    if (!slot) return Promise.resolve()

    if (slot.timer) {
      clearTimeout(slot.timer)
      slot.timer = null
    }

    if (slot.running) return slot.running.then(() => drain(key))

    const run = slot.next
    if (!run) return Promise.resolve()
    slot.next = null

    setStatus(key, { state: 'saving', error: null })

    const running = (async () => {
      try {
        await run()
        if (!slot.next) markSaved(key, slot)
      } catch (e) {
        // 失敗はそのまま知らせる。次の編集が来れば、それを送って上書きされる
        setStatus(key, { state: 'error', error: extractSaveError(e) })
      } finally {
        slot.running = null
      }
    })()

    slot.running = running
    return running.then(() => drain(key))
  }

  return {
    schedule(key, run) {
      const slot = slotOf(key)
      slot.next = run
      setStatus(key, { state: 'pending', error: null })

      if (slot.timer) clearTimeout(slot.timer)
      slot.timer = setTimeout(() => {
        slot.timer = null
        void drain(key)
      }, delay)
    },

    flush(key) {
      return drain(key)
    },

    async flushAll() {
      await Promise.all([...slots.keys()].map((key) => drain(key)))
    },

    busy(key) {
      const slot = slots.get(key)
      return Boolean(slot && (slot.next || slot.running))
    },

    busyKeys() {
      return [...slots.entries()]
        .filter(([, slot]) => slot.next || slot.running)
        .map(([key]) => key)
    },
  }
}

/**
 * 失敗の内容を、画面に出せる一行にする。
 *
 * サーバーは `message` で返す。`statusMessage` は HTTP のステータス行に
 * 載るため日本語が壊れる（docs/04-architecture.md 4.4）。
 */
export function extractSaveError(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const data = (e as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  return '保存に失敗しました'
}
