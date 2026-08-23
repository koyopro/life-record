/**
 * 本文の「行」をまたぐ選択（ScrapboxEditor の複数行選択）で使う端点の計算。
 *
 * 1行編集用の textarea は複数行にまたがれないため、複数行の選択は表示側の
 * DOM に対するブラウザの選択（`Selection`）として組み立てる。その起点・終点を
 * ここで求める。
 */

/** 選択の端点。`Selection.setBaseAndExtent` にそのまま渡せる形にする。 */
export interface LinePoint {
  node: Node
  offset: number
}

/** 要素の中で最初に見つかるテキストノード。 */
export function firstTextNode(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  return walker.nextNode() as Text | null
}

/** 要素の中で最後に見つかるテキストノード。 */
export function lastTextNode(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node: Node | null
  let last: Text | null = null
  while ((node = walker.nextNode())) last = node as Text
  return last
}

/**
 * 行の先頭（`start`）または末尾（`end`）を指す端点を返す。
 *
 * 文字を持たない行（画像だけの行 `[[画像URL]]` や、アイコンだけの行など）は
 * テキストノードが1つも無い。テキストノードを前提にすると、そういう行を
 * 含む選択がまったく作れず、行の編集から抜けたまま選択も付かない
 * （＝フォーカスが本文から外れたように見える）ため、その場合は行の要素
 * そのものを端点にする（`offset` は子ノードの位置）。
 */
export function linePoint(el: Element, edge: 'start' | 'end'): LinePoint {
  const text = edge === 'start' ? firstTextNode(el) : lastTextNode(el)
  if (text) return { node: text, offset: edge === 'start' ? 0 : text.length }
  return { node: el, offset: edge === 'start' ? 0 : el.childNodes.length }
}

/**
 * 囲みの中から、その行番号の要素を探す。
 *
 * **必ず自分の囲みの中だけを見る。** 1つの画面に本文が複数ある
 * （タスク詳細の本文と、日付ごとの作業記録）ため、`document` から探すと
 * 同じ行番号を持つ**別の本文**の行が先に見つかる。作業記録で行を選んだ
 * つもりが、上にある本文の行が選ばれてしまい、コピーも切り取りも
 * 貼り付けも効かない、という形で表に出る。
 */
export function lineElementAt(root: ParentNode | null, index: number): Element | null {
  return root?.querySelector(`[data-line-index="${index}"]`) ?? null
}

/**
 * 選択の端（`node`）が属する行の要素と行番号。
 *
 * `root` の外にある行（別の本文）は自分のものではないので null を返す。
 */
export function closestLineIn(
  root: Element | null,
  node: Node | null,
): { el: Element; index: number } | null {
  const el = (node instanceof Element ? node : node?.parentElement)?.closest(
    '[data-line-index]',
  )
  if (!el || !root || !root.contains(el)) return null
  const index = Number(el.getAttribute('data-line-index'))
  return Number.isNaN(index) ? null : { el, index }
}
