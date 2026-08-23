/**
 * 「そこはキー操作を自分で持っている場所か」の判定
 * （docs/08-todo-management.md 8.4 / docs/11-scrapbox-notation.md 11.6）。
 *
 * 画面ごとのショートカット（`useShortcuts`）は window で打鍵を拾うため、
 * **どこにフォーカスがあるときは手を出さないか**を1か所で決めておかないと、
 * 割り当てを増やすたびに取りこぼしが出る。
 */

/**
 * 「ここは自前でキー操作を持つ」と宣言する印。
 *
 * 入力欄（input / textarea）は勝手にそう扱われるが、**入力欄の外で
 * キーを受ける場所**もある。本文編集（ScrapboxEditor）は行をまたいで
 * 選んでいる間、1行用の textarea を離れて囲み自身がフォーカスを持つ。
 * そのままだと「本文を編集している最中なのに、`Delete` でタスクが消える」
 * 「`c` で完了になる」といったことが起きる。
 *
 * 囲みにこの印を付けておけば、その中にフォーカスがある間は画面側の
 * 割り当てが下がる。個々のハンドラで `stopPropagation` を積むのと違い、
 * **あとから足したショートカットも自動的に避けてくれる**ため、
 * 片方だけ直し忘れることがない。
 */
export const KEYBOARD_SURFACE_ATTR = 'data-keyboard-surface'

/** 打鍵をその場が受け取るか（入力欄、または上の印を付けた囲みの中か）。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest(`[${KEYBOARD_SURFACE_ATTR}]`))
}

/**
 * 文字を選んでいるか。
 *
 * `⌘ + C` のように標準の操作と打鍵が重なる割り当ての `yieldToBrowser` で使う。
 * 選んでいるならその選択を写したいはずなので、ブラウザに譲る。
 * 画面ごとに判断がずれないよう、ここに1つだけ置く。
 */
export function hasTextSelection(): boolean {
  return document.getSelection()?.isCollapsed === false
}
