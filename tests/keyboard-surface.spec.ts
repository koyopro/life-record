import { describe, expect, it } from 'vitest'
import {
  KEYBOARD_SURFACE_ATTR,
  hasTextSelection,
  isTypingTarget,
} from '~/utils/keyboard-surface'

/**
 * 画面のショートカットが手を出さない場所
 * （docs/08-todo-management.md 8.4 / docs/11-scrapbox-notation.md 11.6）。
 *
 * 本文編集は行をまたいで選んでいる間、入力欄を離れて囲み自身がフォーカスを
 * 持つ。ここを「入力していない」と見なすと、`Delete` でタスクが消えたり
 * `⌘ + C` が一覧のコピーになったりする。
 */
describe('キー操作を自分で持つ場所', () => {
  it('入力欄はそのまま対象になる', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isTypingTarget(document.createElement(tag))).toBe(true)
    }
  })

  it('ふつうの要素は対象にならない', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('印を付けた囲みは、その中のどこにフォーカスがあっても対象になる', () => {
    const surface = document.createElement('div')
    surface.setAttribute(KEYBOARD_SURFACE_ATTR, '')
    const line = document.createElement('div')
    surface.append(line)

    // 囲み自身（行を選んでいる間はここがフォーカスを持つ）
    expect(isTypingTarget(surface)).toBe(true)
    // 中の要素（行やボタン）
    expect(isTypingTarget(line)).toBe(true)
  })
})

describe('文字を選んでいるか', () => {
  it('選んでいなければ false、選んでいれば true', () => {
    const el = document.createElement('p')
    el.textContent = 'あいうえお'
    document.body.append(el)

    window.getSelection()?.removeAllRanges()
    expect(hasTextSelection()).toBe(false)

    const text = el.firstChild!
    window.getSelection()?.setBaseAndExtent(text, 0, text, 3)
    expect(hasTextSelection()).toBe(true)

    window.getSelection()?.removeAllRanges()
    el.remove()
  })
})
