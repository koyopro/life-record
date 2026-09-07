/**
 * 本文の TODO リンクを押したときに出すポップオーバー
 * （docs/11-scrapbox-notation.md 11.13）。
 *
 * 出し先は app.vue に1つだけ置く（ImageViewer・ConfirmDialog と同じ）。
 * 本文はどの画面でも同じ部品（ScrapboxEditor）で描いているので、そこから
 * `open` を呼べば、日記でもタスクの詳細でも同じものが出る。
 *
 * 画面を移さずに開くのは、日記を書いている流れを切らないため。押すたびに
 * タスクの画面へ飛ぶと、戻ってきたときに書いていた場所を見失う。
 */

/** ポップオーバーを寄せる先（押したリンクの位置。ビューポート基準）。 */
export interface TodoLinkAnchor {
  top: number
  bottom: number
  left: number
  right: number
}

export interface TodoLinkRequest {
  /** リンクとして見えている文字。TODO を探す題であり、作るときの題でもある。 */
  text: string
  /** 決まっているリンク先。`[題]`（まだ決まっていない）なら null。 */
  itemId: string | null
  anchor: TodoLinkAnchor
}

/**
 * リンク先が決まったことを本文へ返す先。
 *
 * useState には入れない（関数はサーバー描画の payload に載せられない。
 * `useConfirm` と同じ）。開いているポップオーバーは1つだけなので、
 * モジュールに1つ持てば足りる。
 *
 * 読むだけの本文（`view`）から開いたときは渡ってこない。書き換える先が
 * 無いので、そのときは行き先を覚えず、その場の操作だけを受け持つ。
 */
let confirmWith: ((itemId: string) => void) | null = null

export function useTodoLinkPopover() {
  const request = useState<TodoLinkRequest | null>('todo-link:request', () => null)

  /**
   * 開く。
   *
   * @param onConfirm リンク先が決まったときに呼ぶ（本文の `[題]` を
   *   `[/items/<id> 題]` へ書き換えるのは呼び出し側の仕事）。
   */
  function open(next: TodoLinkRequest, onConfirm?: (itemId: string) => void): void {
    confirmWith = onConfirm ?? null
    request.value = next
  }

  function close(): void {
    confirmWith = null
    request.value = null
  }

  /**
   * リンク先を決める。
   *
   * 本文を書き換えるのは**一度だけ**（決まったあとは、同じ題の TODO が
   * 増えても行き先を変えない）。書き換えたら、このポップオーバーは
   * そのタスクを見ている状態へ移る。
   */
  function confirm(itemId: string): void {
    const current = request.value
    if (!current) return

    const notify = confirmWith
    confirmWith = null
    request.value = { ...current, itemId }
    notify?.(itemId)
  }

  return { request, open, close, confirm }
}
