/**
 * アプリの更新（新しい Service Worker）を、いつ当てるかの決まりごと
 * （docs/12-offline.md 12.2）。
 *
 * 新しい版が用意できた瞬間に当てる（＝読み込み直す）と、タスクを書いている
 * 途中でも画面ごと入れ替わる。打ちかけの入力は消え、キャレットも飛ぶ。
 * そこで**書きかけが無くなってから**当てる。
 *
 * Vue に依存させない。ここが「いつ当てるか」の本体で、単体でも試せるように
 * しておきたいため（save-scheduler と同じ考え方）。
 */

/** 手が空いてから当てるまでに置く間。 */
const DEFAULT_QUIET_MS = 3_000

export interface UpdateGateOptions {
  /** 当てる。実際には新しい Service Worker へ入れ替えて読み込み直す。 */
  apply: () => void
  /** 手が空いてから当てるまでの間。 */
  quiet?: number
}

export interface UpdateGate {
  /** 新しい版が用意できた。あとは当てる時機を待つ。 */
  ready(): void
  /** 書きかけの有無が変わった。 */
  setBusy(busy: boolean): void
  /** 待たずに当てる（「いま更新」）。 */
  applyNow(): void
  /** 待つのをやめる。 */
  stop(): void
}

export function createUpdateGate(options: UpdateGateOptions): UpdateGate {
  const quiet = options.quiet ?? DEFAULT_QUIET_MS

  /** 新しい版が用意できているか。 */
  let ready = false
  /** 書きかけがあるか。 */
  let busy = false
  /** もう当てたか。当てると読み込み直すので、二度は要らない。 */
  let applied = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function cancel() {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  /**
   * 当てられる状態になったら数え始める。
   *
   * すぐには当てない。入力の切れ目（変換の確定、欄から欄への移動）でも
   * 書きかけは一瞬だけ消えるので、そこで読み込み直すと「手を止めた途端に
   * 画面が入れ替わった」ことになる。少し置いて、まだ静かなら当てる。
   */
  function reconsider() {
    if (applied) return

    if (!ready || busy) {
      cancel()
      return
    }

    // すでに数えている。数え直して先延ばしにはしない
    if (timer) return

    timer = setTimeout(() => {
      timer = null
      apply()
    }, quiet)
  }

  function apply() {
    if (applied) return
    applied = true
    cancel()
    options.apply()
  }

  return {
    ready() {
      ready = true
      reconsider()
    },

    setBusy(value) {
      busy = value
      reconsider()
    },

    // 押した人の指示なので、書きかけがあっても当てる
    applyNow: apply,

    stop: cancel,
  }
}
