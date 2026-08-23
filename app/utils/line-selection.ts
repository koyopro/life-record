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

/**
 * 行をまたぐ選択の、端の置き方。
 *
 * `Shift`+矢印で選び始めたときのカーソル位置で決まる（ScrapboxEditor）。
 *
 * - `start` … 行頭から伸ばす。`Shift`+`↓` を1回押すと「いまの行頭から次の行の
 *   行頭まで」になり、選ばれるのは**いまの行**だけ
 * - `end`   … 行末から伸ばす。1回押すと「いまの行末から次の行の行末まで」で、
 *   選ばれるのは**次の行**だけ
 * - `line`  … 行まるごと。全選択（`Cmd`+`A`）と、マウスでなぞった選択
 */
export type LineEdge = 'start' | 'end' | 'line'

/**
 * 端点の行番号から、実際に選ばれている行の範囲を出す。
 *
 * 行頭で終わる選択にはその行が入らず、行末から始まる選択には最初の行が
 * 入らない。ここを間違えると、見えている範囲と、コピー・切り取り・削除が
 * 食い違う（1行余分に消える）。
 *
 * 前後関係ではなく選んだ向き（`anchor` → `focus`）のまま返す。何も選んで
 * いない（端点が同じ行の同じ位置）ときは null。
 */
export function lineRangeFor(
  anchor: number,
  focus: number,
  edge: LineEdge,
): { anchor: number; focus: number } | null {
  if (edge === 'line') return { anchor, focus }
  if (anchor === focus) return null

  const forward = anchor < focus
  if (edge === 'start') {
    return forward ? { anchor, focus: focus - 1 } : { anchor: anchor - 1, focus }
  }
  return forward ? { anchor: anchor + 1, focus } : { anchor, focus: focus + 1 }
}
