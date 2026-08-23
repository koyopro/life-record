import { describe, expect, it } from 'vitest'
import {
  closestLineIn,
  lineElementAt,
  linePoint,
  lineRangeFor,
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
 * 行をまたぐ選択の範囲（docs/11-scrapbox-notation.md 11.6 キー操作）。
 *
 * 端をどこに置いたかで、その行が範囲に入るかどうかが変わる。見えている
 * 範囲と、コピー・切り取り・削除の範囲がずれないようにするため。
 */
describe('行をまたぐ選択の範囲', () => {
  it('行頭から下へ伸ばすと、最後の行（行頭で終わる行）は入らない', () => {
    // 2行目の行頭で Shift+↓ を1回 → 2行目だけが選ばれる
    expect(lineRangeFor(1, 2, 'start')).toEqual({ anchor: 1, focus: 1 })
  })

  it('行末から下へ伸ばすと、最初の行（行末から始まる行）は入らない', () => {
    // 2行目の行末で Shift+↓ を1回 → 3行目だけが選ばれる
    expect(lineRangeFor(1, 2, 'end')).toEqual({ anchor: 2, focus: 2 })
  })

  it('行頭から上へ伸ばすと、起点の行は入らない', () => {
    // 2行目の行頭で Shift+↑ を1回 → 1行目だけが選ばれる
    expect(lineRangeFor(1, 0, 'start')).toEqual({ anchor: 0, focus: 0 })
  })

  it('行末から上へ伸ばすと、伸ばした先の行は入らない', () => {
    // 2行目の行末で Shift+↑ を1回 → 2行目だけが選ばれる
    expect(lineRangeFor(1, 0, 'end')).toEqual({ anchor: 1, focus: 1 })
  })

  it('伸ばす前（端点が同じ行）は、何も選んでいない', () => {
    expect(lineRangeFor(1, 1, 'start')).toBeNull()
    expect(lineRangeFor(1, 1, 'end')).toBeNull()
  })

  it('行まるごと（全選択・マウス）は、両端の行がそのまま入る', () => {
    expect(lineRangeFor(0, 2, 'line')).toEqual({ anchor: 0, focus: 2 })
    expect(lineRangeFor(1, 1, 'line')).toEqual({ anchor: 1, focus: 1 })
  })

  it('選んだ向き（anchor → focus）はそのまま返す', () => {
    // 上へ伸ばした選択は、選び直し（字下げのあと）でも同じ向きで作れる
    expect(lineRangeFor(3, 1, 'start')).toEqual({ anchor: 2, focus: 1 })
  })
})
