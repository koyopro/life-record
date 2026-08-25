/**
 * 「本当に消しますか？」の問い合わせ。
 *
 * ブラウザの `confirm()` は使えない。**macOS アプリ（WKWebView）では出ない**
 * ためで、押しても何も起きない操作になってしまう（wry は WKUIDelegate の
 * JavaScript ダイアログを実装していないので、`confirm()` は何も出さずに
 * false を返す。docs/16-macos-app.md 16.8）。
 *
 * 出し先は app.vue に1つだけ置く（ImageViewer と同じ）。呼ぶ側は
 * `await ask(...)` で答えを待てる。
 */

export interface ConfirmRequest {
  message: string
  /** 実行する側のボタンの文字。 */
  confirmLabel: string
  /** 取り返しの付かない操作か（ボタンを赤くする）。 */
  danger: boolean
}

/**
 * 答えを返す先。
 *
 * useState には入れない（関数はサーバー描画の payload に載せられない）。
 * 開いている問い合わせは1つだけなので、モジュールに1つ持てば足りる。
 */
let answerWith: ((ok: boolean) => void) | null = null

export function useConfirm() {
  const request = useState<ConfirmRequest | null>('confirm:request', () => null)

  /** 問い合わせを出し、答えを待つ。閉じる・Esc・背景は「いいえ」。 */
  function ask(
    options: string | { message: string; confirmLabel?: string; danger?: boolean },
  ): Promise<boolean> {
    const input = typeof options === 'string' ? { message: options } : options

    // 前の問い合わせが残っていたら、答えを待っている側を止めない
    answerWith?.(false)

    request.value = {
      message: input.message,
      confirmLabel: input.confirmLabel ?? 'OK',
      danger: input.danger ?? false,
    }

    return new Promise((resolve) => {
      answerWith = resolve
    })
  }

  function answer(ok: boolean): void {
    request.value = null
    const resolve = answerWith
    answerWith = null
    resolve?.(ok)
  }

  return { request, ask, answer }
}
