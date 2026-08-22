import { describe, expect, it } from 'vitest'
import { linePoint } from '~/utils/line-selection'
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
