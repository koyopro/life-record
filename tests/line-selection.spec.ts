import { describe, expect, it } from 'vitest'
import {
  closestLineIn,
  lineElementAt,
  linePoint,
  linePointAt,
  replaceSelection,
  selectionText,
  touchedLines,
  type LineSelection,
  type LineText,
} from '~/utils/line-selection'
import { parseScrapbox } from '~~/shared/utils/scrapbox/parse'
import { renderLine } from '~~/shared/utils/scrapbox/render'

/**
 * 複数行選択（`Shift`+`↑` / `↓`）の端点
 * （docs/11-scrapbox-notation.md 11.6 キー操作）。
 *
 * 画像だけの行はテキストノードを持たないため、テキストノードを前提にすると
 * 選択が組み立てられず、行の編集から抜けたまま選択も付かない（＝本文から
 * フォーカスが外れたように見える）。
 */
function lineElement(raw: string): Element {
  const line = parseScrapbox(raw)[0]!
  const el = document.createElement('div')
  el.innerHTML = renderLine(line)
  return el
}

describe('行をまたぐ選択の端点', () => {
  it('文字のある行では、その行のテキストノードを指す', () => {
    const el = lineElement('[2026/08/20]')

    const start = linePoint(el, 'start')
    const end = linePoint(el, 'end')

    expect(start.node.nodeType).toBe(Node.TEXT_NODE)
    expect(start.offset).toBe(0)
    expect(end.node.nodeType).toBe(Node.TEXT_NODE)
    expect(end.offset).toBe((end.node as Text).length)
  })

  it('画像だけの行（テキストノードが無い）では、行の要素そのものを指す', () => {
    const el = lineElement('\t[[https://gyazo.com/084fe3f522e7dbddd3463727cf355ca3]]')

    // 前提: 画像記法は img だけになり、テキストノードが残らない
    expect(el.textContent).toBe('')

    expect(linePoint(el, 'start')).toEqual({ node: el, offset: 0 })
    expect(linePoint(el, 'end')).toEqual({ node: el, offset: el.childNodes.length })
  })

  it('画像だけの行を端点にしても、行をまたぐ選択を実際に作れる', () => {
    const container = document.createElement('div')
    document.body.append(container)
    container.append(lineElement('[2026/08/20]'))
    container.append(lineElement('[[https://gyazo.com/084fe3f522e7dbddd3463727cf355ca3]]'))

    // 画像の行の行末から、1つ上の行の行頭まで（上へ伸ばす選択）
    const from = linePoint(container.children[1]!, 'end')
    const to = linePoint(container.children[0]!, 'start')
    const selection = window.getSelection()!
    selection.setBaseAndExtent(from.node, from.offset, to.node, to.offset)

    expect(selection.isCollapsed).toBe(false)
    expect(selection.rangeCount).toBe(1)

    container.remove()
  })
})

/**
 * 行の探索は、**その本文の中だけ**を見る。
 *
 * 1つの画面に本文が複数ある（タスク詳細の本文と、日付ごとの作業記録）。
 * `document` から探すと同じ行番号を持つ別の本文の行が先に見つかり、
 * 作業記録で選んだつもりの行がタスク本文の行になってしまう。
 * その結果、作業記録ではコピー・切り取り・貼り付け・削除が効かなくなる。
 */
describe('本文が複数あるときの行の探索', () => {
  function editorWith(lines: string[]): HTMLElement {
    const root = document.createElement('div')
    lines.forEach((raw, index) => {
      const el = lineElement(raw)
      el.setAttribute('data-line-index', String(index))
      root.append(el)
    })
    return root
  }

  it('自分の囲みの中にある行を返す（先に並ぶ別の本文ではない）', () => {
    const page = document.createElement('div')
    const body = editorWith(['本文の1行目', '本文の2行目'])
    const record = editorWith(['作業記録の1行目', '作業記録の2行目'])
    page.append(body, record)
    document.body.append(page)

    expect(lineElementAt(record, 1)?.textContent).toBe('作業記録の2行目')
    expect(lineElementAt(body, 1)?.textContent).toBe('本文の2行目')

    page.remove()
  })

  it('選択の端が別の本文にあるときは、自分のものとして扱わない', () => {
    const body = editorWith(['本文の1行目'])
    const record = editorWith(['作業記録の1行目'])
    document.body.append(body, record)

    const inRecord = record.children[0]!
    expect(closestLineIn(record, inRecord)).toEqual({ el: inRecord, index: 0 })
    expect(closestLineIn(body, inRecord)).toBeNull()
    expect(closestLineIn(null, inRecord)).toBeNull()

    body.remove()
    record.remove()
  })
})

/**
 * カーソルの桁で伸ばす選択（docs/11-scrapbox-notation.md 11.6 キー操作）。
 *
 * ふつうの入力欄と同じく、行の途中で `Shift`+`↓` を押したら次の行の**同じ桁**
 * まで選ばれる。行まるごとになってしまうと、選んだつもりのない文字まで
 * コピー・削除の対象になる。
 */
function text(anchor: [number, number], focus: [number, number], desired?: number): LineSelection {
  return {
    kind: 'text',
    anchor: { line: anchor[0], column: anchor[1] },
    focus: { line: focus[0], column: focus[1] },
    desired: desired ?? focus[1],
  }
}

/** 行頭（`prefix`）と中身に分けた行。`prefix + content === raw`。 */
function lineText(prefix: string, content: string): LineText {
  return { prefix, content, raw: prefix + content }
}

describe('桁で伸ばす選択の端点（DOM）', () => {
  it('桁の位置を指す', () => {
    const el = lineElement('abcdefg')

    expect(linePointAt(el, 0)).toEqual({ node: el.firstChild, offset: 0 })
    expect(linePointAt(el, 3)).toEqual({ node: el.firstChild, offset: 3 })
  })

  it('行の長さを超えたら行末に収める', () => {
    const el = lineElement('abc')

    expect(linePointAt(el, 10)).toEqual({ node: el.firstChild, offset: 3 })
  })

  it('文字を持たない行（画像だけの行）は、行の要素そのものを指す', () => {
    const el = lineElement('[[https://gyazo.com/084fe3f522e7dbddd3463727cf355ca3]]')

    expect(linePointAt(el, 0)).toEqual({ node: el, offset: 0 })
    expect(linePointAt(el, 4)).toEqual({ node: el, offset: el.childNodes.length })
  })
})

describe('選んでいる部分のテキスト', () => {
  const lines = [lineText('', 'abcde'), lineText('', 'fghij'), lineText(' ', 'klmno')]

  it('カーソルの桁から、次の行の同じ桁まで', () => {
    expect(selectionText(text([0, 2], [1, 2]), lines)).toBe('cde\nfg')
  })

  it('上へ伸ばした選択も、見えている範囲と同じ', () => {
    expect(selectionText(text([1, 2], [0, 2]), lines)).toBe('cde\nfg')
  })

  it('行頭で終わる選択は、その行の文字を含まない（改行まで）', () => {
    expect(selectionText(text([0, 2], [1, 0]), lines)).toBe('cde\n')
  })

  it('行の頭から入る行は、余白にしている行頭（字下げ）も持ち出す', () => {
    expect(selectionText(text([1, 0], [2, 3]), lines)).toBe('fghij\n klm')
  })

  it('行まるごと（全選択・マウス）は、記法込みの生テキスト', () => {
    expect(selectionText({ kind: 'line', anchor: 0, focus: 2 }, lines)).toBe(
      'abcde\nfghij\n klmno',
    )
  })
})

describe('選んだ部分の置き換え（削除・貼り付け）', () => {
  const lines = [lineText('', 'abcde'), lineText('', 'fghij'), lineText(' ', 'klmno')]

  it('桁で選んだ部分を消すと、両端の行が1行に繋がる', () => {
    expect(replaceSelection(text([0, 2], [1, 2]), lines, '')).toEqual({
      lines: ['abhij', ' klmno'],
      caret: { line: 0, column: 2 },
    })
  })

  it('消したあとのカーソルは、選び始めた桁に戻る', () => {
    expect(replaceSelection(text([1, 1], [2, 2]), lines, '').caret).toEqual({
      line: 1,
      column: 1,
    })
  })

  it('桁で選んだ部分への貼り付けは、選んだ文字だけを置き換える', () => {
    expect(replaceSelection(text([0, 2], [1, 2]), lines, 'XY')).toEqual({
      lines: ['abXYhij', ' klmno'],
      caret: { line: 0, column: 4 },
    })
  })

  it('複数行を貼り付けると、後ろの文字は最後の行に残る', () => {
    expect(replaceSelection(text([0, 2], [1, 2]), lines, 'X\nY')).toEqual({
      lines: ['abX', 'Yhij', ' klmno'],
      caret: { line: 1, column: 1 },
    })
  })

  it('行まるごとの選択を消すと、その行ごと無くなる', () => {
    expect(replaceSelection({ kind: 'line', anchor: 0, focus: 1 }, lines, '')).toEqual({
      lines: [' klmno'],
      caret: { line: 0, column: 0 },
    })
  })

  it('本文が空になっても、書ける行は1つ残す', () => {
    expect(replaceSelection({ kind: 'line', anchor: 0, focus: 2 }, lines, '').lines).toEqual([''])
  })
})

/**
 * 字下げ（`Tab`）が効く行の範囲（docs/11-scrapbox-notation.md 11.6 キー操作）。
 *
 * 端をどこに置いたかで、その行が範囲に入るかどうかが変わる。見えている
 * 範囲と食い違うと、選んでいない行まで字下げが動く。
 */
describe('選択が文字を含んでいる行の範囲', () => {
  const contents = ['abcde', 'fghij', 'klmno', 'pqrst']

  it('行頭から下へ伸ばすと、最後の行（行頭で終わる行）は入らない', () => {
    // 2行目の行頭で Shift+↓ を1回 → 2行目だけ
    expect(touchedLines(text([1, 0], [2, 0]), contents)).toEqual({ anchor: 1, focus: 1 })
  })

  it('行末から下へ伸ばすと、最初の行（行末から始まる行）は入らない', () => {
    // 2行目の行末で Shift+↓ を1回 → 3行目だけ
    expect(touchedLines(text([1, 5], [2, 5]), contents)).toEqual({ anchor: 2, focus: 2 })
  })

  it('行の途中から伸ばすと、両端の行がどちらも入る', () => {
    expect(touchedLines(text([1, 2], [2, 2]), contents)).toEqual({ anchor: 1, focus: 2 })
  })

  it('行頭から上へ伸ばすと、起点の行は入らない', () => {
    expect(touchedLines(text([1, 0], [0, 0]), contents)).toEqual({ anchor: 0, focus: 0 })
  })

  it('伸ばす前（両端が同じ位置）は、何も選んでいない', () => {
    expect(touchedLines(text([1, 2], [1, 2]), contents)).toBeNull()
  })

  it('行まるごと（全選択・マウス）は、両端の行がそのまま入る', () => {
    expect(touchedLines({ kind: 'line', anchor: 0, focus: 2 }, contents)).toEqual({
      anchor: 0,
      focus: 2,
    })
  })

  it('選んだ向き（anchor → focus）はそのまま返す', () => {
    // 上へ伸ばした選択は、選び直し（字下げのあと）でも同じ向きで作れる
    expect(touchedLines(text([3, 0], [1, 0]), contents)).toEqual({ anchor: 2, focus: 1 })
  })
})
