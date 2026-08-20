import { describe, expect, it } from 'vitest'
import { composeItemCopyText } from '~/utils/item-copy'

describe('composeItemCopyText', () => {
  it('1件は、1行目タイトル・2行目以降が本文（追加の入力と同じ形）', () => {
    const text = composeItemCopyText([
      { title: '請求書を出す', body: '先月分\n\t宛先は経理' },
    ])

    expect(text).toBe('請求書を出す\n先月分\n\t宛先は経理')
  })

  it('本文が無ければタイトルだけ', () => {
    expect(composeItemCopyText([{ title: '牛乳を買う', body: null }])).toBe('牛乳を買う')
    expect(composeItemCopyText([{ title: '牛乳を買う', body: '  \n\n' }])).toBe('牛乳を買う')
  })

  it('本文の行末の空白は落とす。行頭（字下げ）は残す', () => {
    const text = composeItemCopyText([{ title: 'メモ', body: '\t字下げ\n\n' }])

    expect(text).toBe('メモ\n\t字下げ')
  })

  it('複数件はタイトルだけを並べる', () => {
    const text = composeItemCopyText([
      { title: '1件目', body: '本文1' },
      { title: '2件目', body: null },
    ])

    expect(text).toBe('1件目\n2件目')
  })

  it('対象が無ければ空', () => {
    expect(composeItemCopyText([])).toBe('')
  })
})
