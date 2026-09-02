import { describe, expect, it } from 'vitest'
import {
  dropsIndentOnEnter,
  indentOf,
  parseScrapbox,
} from '~~/shared/utils/scrapbox/parse'

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

/**
 * 字下げの空白しか無い行で改行したら、その字下げを外す
 * （docs/11-scrapbox-notation.md 11.6）。
 *
 * 箇条書きの深いところまで書いて次の話に移るとき、`Backspace` で1段ずつ
 * 戻さずに済むようにする。
 */
describe('字下げだけの行での改行', () => {
  const lineOf = (input: string) => parseScrapbox(input)[0]!

  it('字下げの空白しか無い行は、字下げを外す', () => {
    expect(dropsIndentOnEnter(lineOf(' '), '')).toBe(true)
    expect(dropsIndentOnEnter(lineOf('   '), '')).toBe(true)
    // 全角スペースの字下げも同じ
    expect(dropsIndentOnEnter(lineOf('　'), '')).toBe(true)
  })

  it('中身のある行は、これまでどおり字下げを引き継ぐ', () => {
    expect(dropsIndentOnEnter(lineOf(' 牛乳'), '牛乳')).toBe(false)
    // 打ちかけの中身は入力欄の側にある（行は空でも、書いていれば外さない）
    expect(dropsIndentOnEnter(lineOf(' '), '牛')).toBe(false)
  })

  it('字下げのない空行は、外すものが無い', () => {
    expect(dropsIndentOnEnter(lineOf(''), '')).toBe(false)
  })

  it('引用・コードブロック・表の中の空行は外さない（中身として意味がある）', () => {
    const quote = parseScrapbox(' > ')[0]!
    expect(dropsIndentOnEnter(quote, '')).toBe(false)

    const code = parseScrapbox('code:a.js\n ')[1]!
    expect(code.type).toBe('codeBody')
    expect(dropsIndentOnEnter(code, '')).toBe(false)

    const table = parseScrapbox('table:図\n ')[1]!
    expect(table.type).toBe('tableRow')
    expect(dropsIndentOnEnter(table, '')).toBe(false)
  })
})
