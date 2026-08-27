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

/**
 * 行の中のテキストノードを順に返す。
 *
 * ボタンの中（コードブロックの「コピー」）は行の文字ではないので飛ばす。
 * 数えてしまうと、その行の行末や桁がボタンの文字の中を指してしまう。
 */
function textNodesIn(el: Element): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('button')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) nodes.push(node as Text)
  return nodes
}

/** 要素の中で最初に見つかるテキストノード。 */
export function firstTextNode(el: Element): Text | null {
  return textNodesIn(el)[0] ?? null
}

/** 要素の中で最後に見つかるテキストノード。 */
export function lastTextNode(el: Element): Text | null {
  const nodes = textNodesIn(el)
  return nodes[nodes.length - 1] ?? null
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
 * 行の `column` 文字目を指す端点を返す。行の長さを超えたら行末に収める。
 *
 * 桁は表示されている文字で数える。記法のある行（リンクなど）は書いた文字数と
 * 表示の文字数が違うので、その行では**見た目の同じ桁**を指すことになる。
 * 文字を持たない行（画像だけの行）は、`linePoint` と同じく行の要素そのもの。
 */
export function linePointAt(el: Element, column: number): LinePoint {
  let seen = 0
  let last: Text | null = null
  for (const text of textNodesIn(el)) {
    if (column <= seen + text.length) return { node: text, offset: Math.max(0, column - seen) }
    seen += text.length
    last = text
  }
  if (last) return { node: last, offset: last.length }
  return { node: el, offset: column <= 0 ? 0 : el.childNodes.length }
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
 * 行をまたぐ選択の中の、1点。
 *
 * `column` は、その行の **`content` 上の位置**（行頭 `prefix` は数えない）。
 * 1行編集用の入力欄（textarea）が持つのも `content` なので、カーソル位置を
 * そのまま端点にできる。
 */
export interface LinePosition {
  line: number
  column: number
}

/**
 * 行をまたぐ選択。
 *
 * - `text` … **カーソルの桁を端にする選択**（`Shift`+矢印）。ふつうの入力欄と
 *   同じく、行の途中から `Shift`+`↓` を押せば次の行の同じ桁まで伸びる。
 *   `desired` は上下に動かしても保つ桁で、短い行を通り過ぎても元の桁へ戻る
 *   （`Shift` なしの上下移動が `desiredColumn` で保つのと同じ）。
 *   左右で始めた選択は行の端へ伸ばすので、`0`（行頭）か `Infinity`（行末）。
 * - `line` … 行まるごと（全選択 `Cmd`+`A` と、マウスでなぞった選択）。
 *   桁を持たないため、常に行の頭から終わりまでを範囲にする。
 */
export type LineSelection =
  | { kind: 'text'; anchor: LinePosition; focus: LinePosition; desired: number }
  | { kind: 'line'; anchor: number; focus: number }

/** 行の中身。`prefix + content === raw`（parse.ts）。 */
export interface LineText {
  prefix: string
  content: string
  raw: string
}

/** 選択の前後を、行・桁の順で並べ直す。 */
function ordered(selection: Extract<LineSelection, { kind: 'text' }>): {
  start: LinePosition
  end: LinePosition
} {
  const { anchor, focus } = selection
  const forward =
    anchor.line < focus.line || (anchor.line === focus.line && anchor.column <= focus.column)
  return forward ? { start: anchor, end: focus } : { start: focus, end: anchor }
}

/** 端の桁を、その行の中身に収める。行が無ければ 0。 */
export function clampColumn(column: number, contents: string[], line: number): number {
  return Math.max(0, Math.min(column, contents[line]?.length ?? 0))
}

/**
 * 選択が**文字を含んでいる**行の範囲。何も選んでいなければ null。
 *
 * 字下げ（`Tab`）はこの範囲の行すべてに効かせる。行末から始まる選択に
 * その行は入らず、行頭で終わる選択にその行は入らない。見えている範囲と
 * 食い違うと、選んでいない行まで動いてしまうため。
 *
 * 前後関係ではなく選んだ向き（`anchor` → `focus`）のまま返す。選び直すとき
 * （字下げのあとなど）に、上へ伸ばした選択をそのまま作り直せるようにする。
 */
export function touchedLines(
  selection: LineSelection,
  contents: string[],
): { anchor: number; focus: number } | null {
  if (selection.kind === 'line') return { anchor: selection.anchor, focus: selection.focus }

  const { start, end } = ordered(selection)
  if (start.line === end.line && start.column === end.column) return null

  // 行末から始まる行・行頭で終わる行は、その行の文字を含まない
  const first = start.column >= (contents[start.line]?.length ?? 0) ? start.line + 1 : start.line
  const last = end.column === 0 ? end.line - 1 : end.line
  if (first > last) return null

  const forward = selection.anchor.line <= selection.focus.line
  return forward ? { anchor: first, focus: last } : { anchor: last, focus: first }
}

/**
 * 選んでいる部分のテキスト（記法込みの生テキスト）。
 *
 * 表示側は行頭（字下げ・`>` ・`code:`）を文字ではなく余白として見せている
 * ため、ブラウザの選択文字列を写すとその部分が抜け落ちる。行の頭から
 * 入っている行は、行頭も含めて持ち出す。
 */
export function selectionText(selection: LineSelection, lines: LineText[]): string {
  if (selection.kind === 'line') {
    const start = Math.min(selection.anchor, selection.focus)
    const end = Math.max(selection.anchor, selection.focus)
    return lines
      .slice(start, end + 1)
      .map((line) => line.raw)
      .join('\n')
  }

  const { start, end } = ordered(selection)
  const first = lines[start.line]
  const last = lines[end.line]
  if (!first || !last) return ''

  if (start.line === end.line) return first.content.slice(start.column, end.column)

  const head = (start.column === 0 ? first.prefix : '') + first.content.slice(start.column)
  const middle = lines.slice(start.line + 1, end.line).map((line) => line.raw)
  // 行頭で終わる選択は、その行を1文字も含まない（改行までで終わる）
  const tail = end.column === 0 ? '' : last.prefix + last.content.slice(0, end.column)
  return [head, ...middle, tail].join('\n')
}

/**
 * 選んだ部分を `text` で置き換えたあとの行と、カーソルを戻す位置。
 *
 * 削除（`Delete`）は空文字を、貼り付け（`Cmd`+`V`）は貼り付ける文字列を渡す。
 * 桁で選んでいるときは、ふつうの入力欄と同じく**選んだ文字だけ**を置き換え、
 * 両端の行は1行に繋がる。行まるごとの選択は、行ごと入れ替える。
 */
export function replaceSelection(
  selection: LineSelection,
  lines: LineText[],
  text: string,
): { lines: string[]; caret: { line: number; column: number | 'end' } } {
  const raws = lines.map((line) => line.raw)
  const pasted = text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n')

  if (selection.kind === 'line') {
    const start = Math.min(selection.anchor, selection.focus)
    const end = Math.max(selection.anchor, selection.focus)
    raws.splice(start, end - start + 1, ...pasted)
    // 本文が空になっても、書ける行は1つ残す
    if (raws.length === 0) raws.push('')
    return {
      lines: raws,
      caret:
        pasted.length === 0
          ? { line: Math.min(start, raws.length - 1), column: 0 }
          : { line: start + pasted.length - 1, column: 'end' },
    }
  }

  const { start, end } = ordered(selection)
  const first = lines[start.line]
  const last = lines[end.line]
  if (!first || !last) return { lines: raws, caret: { line: start.line, column: start.column } }

  const head = first.prefix + first.content.slice(0, start.column)
  const tail = last.content.slice(end.column)
  const parts = pasted.length === 0 ? [''] : pasted
  const replaced = parts.map((part, i) => {
    const before = i === 0 ? head : ''
    const after = i === parts.length - 1 ? tail : ''
    return before + part + after
  })

  raws.splice(start.line, end.line - start.line + 1, ...replaced)
  const lastPart = parts[parts.length - 1]!
  return {
    lines: raws,
    caret: {
      line: start.line + parts.length - 1,
      column: parts.length === 1 ? start.column + lastPart.length : lastPart.length,
    },
  }
}
