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
