import { describe, expect, it } from 'vitest'
import { parseScrapbox } from '~~/shared/utils/scrapbox/parse'
import { lineClass, renderLine } from '~~/shared/utils/scrapbox/render'

/**
 * 区切りの罫線（docs/11-scrapbox-notation.md 11.5）。
 *
 * Scrapbox と同じく、ハイフンを4つ以上並べただけの行を1本の線として出す。
 * 3つ以下を取らないのは、文中の「---」のような書き方まで線になってしまうため。
 */
describe('罫線の行', () => {
  it('ハイフン4つだけの行を罫線として扱う', () => {
    const line = parseScrapbox('----')[0]!
    expect(line).toMatchObject({ type: 'rule', indent: 0, prefix: '', content: '----' })
  })

  it('4つより多くても罫線', () => {
    expect(parseScrapbox('--------')[0]).toMatchObject({ type: 'rule' })
  })

  it('3つ以下は、ただの文字のまま', () => {
    expect(parseScrapbox('---')[0]).toMatchObject({ type: 'text' })
  })

  it('ハイフン以外が混ざる行は、ただの文字のまま', () => {
    expect(parseScrapbox('---- ここから')[0]).toMatchObject({ type: 'text' })
    expect(parseScrapbox('前置き ----')[0]).toMatchObject({ type: 'text' })
  })

  it('字下げした行でも罫線になり、字下げは行頭に残る', () => {
    const line = parseScrapbox('  ----')[0]!
    expect(line).toMatchObject({ type: 'rule', indent: 2, prefix: '  ', content: '----' })
    // 行頭 + 中身は、書かれたままの行に戻る（カーソルを置けば直せる）
    expect(line.prefix + line.content).toBe(line.raw)
  })

  it('コードブロックの中では、中身のまま（線にしない）', () => {
    const lines = parseScrapbox('code:sample\n ----')
    expect(lines[1]).toMatchObject({ type: 'codeBody', content: '----' })
  })

  it('引用の中では、引用のまま', () => {
    expect(parseScrapbox('> ----')[0]).toMatchObject({ type: 'quote' })
  })

  it('前後の行はそのまま。1行が1要素の対応も崩さない', () => {
    const lines = parseScrapbox('前の行\n----\n次の行')
    expect(lines.map((line) => line.type)).toEqual(['text', 'rule', 'text'])
  })

  it('表示は線だけで、ハイフンは文字として出さない', () => {
    const line = parseScrapbox('----')[0]!
    expect(renderLine(line)).toBe('<hr class="sb-rule" />')
    expect(lineClass(line)).toContain('sb-line--rule')
  })
})
