import { describe, expect, it } from 'vitest'
import { indentOf, parseScrapbox } from '~~/shared/utils/scrapbox/parse'

/**
 * 行頭の全角スペースも、半角スペースと同じ字下げとして扱う
 * （docs/11-scrapbox-notation.md 箇条書き）。
 *
 * スマートフォンの日本語入力では、変換の確定時などに全角スペースが
 * 紛れ込みやすいため、半角と区別せずリスト記法の階層として認識する。
 */
describe('全角スペースの字下げ', () => {
  it('全角スペース1つを、半角スペース1つと同じ1段として数える', () => {
    expect(indentOf('　買い物')).toBe(1)
    expect(indentOf(' 買い物')).toBe(1)
  })

  it('半角と全角が混ざっていても、先頭から続く分をまとめて数える', () => {
    expect(indentOf('  　牛乳')).toBe(3)
  })

  it('全角スペースの後ろの中身には含めない', () => {
    expect(indentOf('　牛乳　パン')).toBe(1)
  })

  it('parseScrapbox でも全角スペースの行が字下げされた階層になる', () => {
    const lines = parseScrapbox('買い物\n　牛乳')
    expect(lines[0]).toMatchObject({ indent: 0, content: '買い物' })
    expect(lines[1]).toMatchObject({ indent: 1, content: '牛乳', prefix: '　' })
  })
})
