import { describe, expect, it } from 'vitest'
import { caretAfterSplit } from '~/utils/caret-shift'

/**
 * 画像を差し込んだあとのカーソル（docs/11-scrapbox-notation.md 11.7）。
 * 上げている間も書き続けられるよう、書いている人の位置を見た目のまま保つ。
 */
describe('caretAfterSplit', () => {
  it('割った行より上は動かない', () => {
    const caret = { index: 1, offset: 3 }

    expect(caretAfterSplit(caret, { index: 4, offset: 0, hasBefore: false }, 1)).toEqual(caret)
  })

  it('割った行より下は、増えた行数だけ下へ', () => {
    const caret = { index: 6, offset: 3 }

    expect(caretAfterSplit(caret, { index: 4, offset: 2, hasBefore: true }, 2)).toEqual({
      index: 8,
      offset: 3,
    })
  })

  it('割った位置より後ろにいたら、後ろ半分の行の同じ文字へ', () => {
    const caret = { index: 4, offset: 7 }

    expect(caretAfterSplit(caret, { index: 4, offset: 2, hasBefore: true }, 2)).toEqual({
      index: 6,
      offset: 5,
    })
  })

  it('割った位置より前にいたら、前半分の行に残る', () => {
    const caret = { index: 4, offset: 1 }

    expect(caretAfterSplit(caret, { index: 4, offset: 2, hasBefore: true }, 2)).toEqual({
      index: 4,
      offset: 1,
    })
  })

  it('行頭で割ったとき、残った文字は後ろ半分の行にある', () => {
    const caret = { index: 4, offset: 0 }

    expect(caretAfterSplit(caret, { index: 4, offset: 0, hasBefore: false }, 1)).toEqual({
      index: 5,
      offset: 0,
    })
  })

  it('空行を画像にしたとき（前も後ろも無い）は、その次の行へ', () => {
    const caret = { index: 4, offset: 0 }

    expect(caretAfterSplit(caret, { index: 4, offset: 0, hasBefore: false }, 0)).toEqual({
      index: 5,
      offset: 0,
    })
  })
})
