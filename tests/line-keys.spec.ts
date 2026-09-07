import { describe, expect, it } from 'vitest'
import { lineKeysOf } from '~/utils/line-keys'

/**
 * 本文の行を見分ける印（docs/11-scrapbox-notation.md 11.12「読み直しを起こさない」）。
 *
 * 行が増減しても、**変わっていない行の印は変わらない**ことが要。変わると
 * その行は別の要素として描き直され、埋め込み（iframe）が読み直しになる。
 */
describe('行の key', () => {
  const EMBED = '[https://kifu.tsumego.jp/example]'

  it('行が増えても、変わっていない行の印は変わらない', () => {
    const before = lineKeysOf(['一行目', EMBED, '三行目'])
    const after = lineKeysOf(['一行目', '', EMBED, '三行目'])

    expect(after).toContain(before[1])
    expect(after).toContain(before[2])
  })

  it('行が減っても、変わっていない行の印は変わらない', () => {
    const before = lineKeysOf(['一行目', '消す行', EMBED])
    const after = lineKeysOf(['一行目', EMBED])

    expect(after).toContain(before[2])
  })

  it('その行を書き換えたときは印も変わる（そこは描き直してよい）', () => {
    const before = lineKeysOf([EMBED])
    const after = lineKeysOf(['[https://kifu.tsumego.jp/other]'])

    expect(after[0]).not.toBe(before[0])
  })

  it('同じ文字の行が並んでも、印は重ならない', () => {
    const keys = lineKeysOf(['', '', 'メモ', 'メモ', ''])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('同じ文字の行のうち、順番の変わらないものは印も変わらない', () => {
    const before = lineKeysOf(['メモ', 'メモ', EMBED])
    const after = lineKeysOf(['メモ', 'メモ', '足した行', EMBED])

    expect(after.slice(0, 2)).toEqual(before.slice(0, 2))
    expect(after).toContain(before[2])
  })
})
