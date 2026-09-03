import { describe, expect, it } from 'vitest'
import { insertImageLines } from '~/utils/image-insert'

/**
 * 画像を差し込む位置（docs/11-scrapbox-notation.md 11.7「挿入する位置」）。
 *
 * 貼った（落とした）ときのカーソルの位置に入れる。行の末尾では行を割らず、
 * 途中では書きかけの文が画像記法で割られないよう1行として置く。
 */

const IMAGE = 'https://i.gyazo.com/733b193a4485f26c8acc45d03b412c8f.png'
const NOTATION = `[${IMAGE}]`

describe('画像を差し込む位置', () => {
  it('行の末尾では改行を挟まず、その行へ続ける', () => {
    const inserted = insertImageLines(['きょうの記録', '次の行'], { index: 0, offset: 6 }, IMAGE)

    expect(inserted.lines).toEqual([`きょうの記録 ${NOTATION}`, '次の行'])
    // 行は増えていないので、下の行の番号も動かない
    expect(inserted.added).toBe(0)
    expect(inserted.split).toBeNull()
    // 続きは次の行から（画像の入った行へ戻すと記法が生のまま出てくる）
    expect(inserted.at).toEqual({ index: 1, offset: 0 })
  })

  it('末尾がすでに空白なら、区切りの空白は足さない', () => {
    const inserted = insertImageLines(['きょうの記録 '], { index: 0, offset: 7 }, IMAGE)

    expect(inserted.lines).toEqual([`きょうの記録 ${NOTATION}`])
  })

  it('字下げや引用の行でも、行頭はそのままに末尾へ続ける', () => {
    const inserted = insertImageLines(['\t> 引用'], { index: 0, offset: 2 }, IMAGE)

    expect(inserted.lines).toEqual([`\t> 引用 ${NOTATION}`])
  })

  it('空行に入れたときは、その行がそのまま画像になる', () => {
    const inserted = insertImageLines(['前の行', '', '次の行'], { index: 1, offset: 0 }, IMAGE)

    expect(inserted.lines).toEqual(['前の行', NOTATION, '次の行'])
    expect(inserted.added).toBe(0)
  })

  it('行の途中では1行として置き、カーソルより後ろは画像の下へ回す', () => {
    const inserted = insertImageLines(['まえ うしろ'], { index: 0, offset: 2 }, IMAGE)

    expect(inserted.lines).toEqual(['まえ', NOTATION, ' うしろ'])
    expect(inserted.added).toBe(2)
    expect(inserted.split).toEqual({ index: 0, offset: 2, hasBefore: true })
    expect(inserted.at).toEqual({ index: 2, offset: 0 })
  })

  it('行頭にカーソルがあるときは、画像を上の行として置く', () => {
    const inserted = insertImageLines(['\tうしろ'], { index: 0, offset: 0 }, IMAGE)

    expect(inserted.lines).toEqual([`\t${NOTATION}`, '\tうしろ'])
    expect(inserted.split).toEqual({ index: 0, offset: 0, hasBefore: false })
  })

  it('位置が分からなければ末尾に足す', () => {
    const inserted = insertImageLines(['1行目'], null, IMAGE)

    expect(inserted.lines).toEqual(['1行目', NOTATION])
    expect(inserted.at).toEqual({ index: 2, offset: 0 })
    expect(inserted.split).toBeNull()
  })

  it('2枚目は、1枚目の下へ順に並ぶ', () => {
    const first = insertImageLines(['きょうの記録'], { index: 0, offset: 6 }, IMAGE)
    const second = insertImageLines(first.lines, first.at, IMAGE)

    expect(second.lines).toEqual([`きょうの記録 ${NOTATION}`, NOTATION])
  })
})
