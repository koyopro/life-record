import { describe, expect, it } from 'vitest'
import {
  continuationPrefix,
  linesFromInput,
  parseScrapbox,
} from '~~/shared/utils/scrapbox/parse'
import type { Line } from '~~/shared/utils/scrapbox/types'

/**
 * 複数行の貼り付け（docs/11-scrapbox-notation.md 11.6）。
 *
 * 行頭（字下げ・`>` ・`code:`）は表示では余白になり、その行がどこに属するかを
 * 決めている。2行目以降にも引き継がないと、コードブロックや引用の中に貼った
 * ときに1行目だけがその中に残る。
 */

/** その本文の n 行目（0 始まり）。 */
function lineOf(input: string, index: number): Line {
  return parseScrapbox(input)[index]!
}

describe('continuationPrefix', () => {
  it('字下げを引き継ぐ', () => {
    expect(continuationPrefix(lineOf('買い物\n 牛乳', 1))).toBe(' ')
  })

  it('引用の `>` を引き継ぐ', () => {
    expect(continuationPrefix(lineOf('> ひとこと', 0))).toBe('> ')
  })

  it('コードブロックの中は、その基準の字下げを引き継ぐ', () => {
    expect(continuationPrefix(lineOf('code:a.js\n  中身', 1))).toBe(' ')
  })

  it('`code:` の行は、中身と同じ基準の字下げにする（block を増やさない）', () => {
    expect(continuationPrefix(lineOf('code:a.js', 0))).toBe(' ')
  })

  it('行頭の無い行は、そのまま行頭なし', () => {
    expect(continuationPrefix(lineOf('メモ', 0))).toBe('')
  })
})

describe('linesFromInput', () => {
  it('コードブロックの中では、貼り付けた全ての行がブロックの中に残る', () => {
    const line = lineOf('code:a.js\n ', 1)
    const pasted = ['function hello() {', '  return 1', '}'].join('\n')

    const lines = linesFromInput(pasted, line)

    expect(lines).toEqual([' function hello() {', '   return 1', ' }'])
    // 解析し直しても、すべてコードブロックの中身のまま
    const parsed = parseScrapbox(['code:a.js', ...lines].join('\n'))
    expect(parsed.map((l) => l.type)).toEqual([
      'codeHeader',
      'codeBody',
      'codeBody',
      'codeBody',
    ])
  })

  it('貼り付けた側の字下げは、行頭の後ろにそのまま残る', () => {
    expect(linesFromInput('a\n  b', lineOf('code:a.js\n ', 1))).toEqual([' a', '   b'])
  })

  it('引用の中では、続きの行にも `>` を付ける', () => {
    const lines = linesFromInput('1行目\n2行目', lineOf('> ', 0))

    expect(lines).toEqual(['> 1行目', '> 2行目'])
    expect(parseScrapbox(lines.join('\n')).map((l) => l.type)).toEqual(['quote', 'quote'])
  })

  it('字下げした行では、続きの行も同じ深さにする', () => {
    expect(linesFromInput('牛乳\nパン', lineOf('買い物\n ', 1))).toEqual([' 牛乳', ' パン'])
  })

  it('行頭の無い行では、貼り付けたままの行になる', () => {
    expect(linesFromInput('1行目\n2行目', lineOf('メモ', 0))).toEqual(['1行目', '2行目'])
  })

  it('改行を含まなければ1行のまま', () => {
    expect(linesFromInput('ひとこと', lineOf('> ', 0))).toEqual(['> ひとこと'])
  })
})
