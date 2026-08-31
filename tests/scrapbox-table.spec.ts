import { describe, expect, it } from 'vitest'
import {
  continuationPrefix,
  dropPrefixUnit,
  parseScrapbox,
} from '~~/shared/utils/scrapbox/parse'
import { lineClass, renderLine, tableColumns } from '~~/shared/utils/scrapbox/render'
import type { Line, TableRowLine } from '~~/shared/utils/scrapbox/types'

/**
 * 表（`table:名前`）。docs/11-scrapbox-notation.md 11.3。
 *
 * Scrapbox と同じく、`table:` の行に続く「1段以上深い行」を表の行として読み、
 * 中身をタブで桁に分ける。
 */
const SAMPLE = ['table:サイズ', ' 日付\t左\t右', '\t2025/08/03\t13.6\t13.5'].join('\n')

/** n 行目を表の行として取り出す（型を絞る）。 */
function rowOf(lines: Line[], index: number): TableRowLine {
  const line = lines[index]!
  if (line.type !== 'tableRow') throw new Error(`${index} 行目が表の行ではない`)
  return line
}

describe('表の読み取り', () => {
  it('`table:` の行は名前だけを中身に持つ', () => {
    const line = parseScrapbox(SAMPLE)[0]!

    expect(line).toMatchObject({ type: 'tableHeader', prefix: 'table:', content: 'サイズ' })
  })

  it('続く行を表の行として読み、タブで桁に分ける', () => {
    const lines = parseScrapbox(SAMPLE)

    expect(lines.map((line) => line.type)).toEqual(['tableHeader', 'tableRow', 'tableRow'])
    expect(rowOf(lines, 1).cells).toEqual([
      [{ type: 'text', value: '日付' }],
      [{ type: 'text', value: '左' }],
      [{ type: 'text', value: '右' }],
    ])
  })

  it('行頭（字下げ）は中身に入れない。書かれたままの行には戻せる', () => {
    const row = rowOf(parseScrapbox(SAMPLE), 2)

    expect(row.prefix).toBe('\t')
    expect(row.content).toBe('2025/08/03\t13.6\t13.5')
    expect(row.prefix + row.content).toBe(row.raw)
  })

  it('字下げが浅くなったら表を抜ける', () => {
    const lines = parseScrapbox([SAMPLE, '外の行'].join('\n'))

    expect(lines[3]).toMatchObject({ type: 'text', content: '外の行' })
  })

  it('最後の行に印を付ける（見た目をまとめるため）', () => {
    const lines = parseScrapbox(SAMPLE)

    expect(rowOf(lines, 1).last).toBe(false)
    expect(rowOf(lines, 2).last).toBe(true)
    expect(lineClass(lines[2]!)).toContain('sb-line--table-last')
  })

  it('コードブロックの中では、表として読まない', () => {
    const lines = parseScrapbox(['code:sample', ' table:サイズ', '  a\tb'].join('\n'))

    expect(lines.map((line) => line.type)).toEqual(['codeHeader', 'codeBody', 'codeBody'])
  })
})

/**
 * 桁の幅は**表の中の全行で同じ**。行はそれぞれ別の要素として描かれるので
 * （1行 = 1要素）、行ごとに中身から決めると桁がそろわない。
 */
describe('桁の幅', () => {
  it('その桁でいちばん広い中身に合わせる（全角は2つぶん）', () => {
    const lines = parseScrapbox(SAMPLE)

    // 「日付」= 4 だが、下の行の 2025/08/03 = 10 に合わせる
    expect(rowOf(lines, 1).columns).toEqual([10, 4, 4])
    expect(rowOf(lines, 2).columns).toEqual([10, 4, 4])
  })

  it('記法は取り除いて数える（リンクの桁だけ広がらないように）', () => {
    const lines = parseScrapbox(['table:t', ' [https://example.com/very/long/url リンク]'].join('\n'))

    // 見た目は「リンク」の3文字（全角なので6）
    expect(rowOf(lines, 1).columns).toEqual([6])
  })

  it('長すぎる桁は頭打ちにする（画面からはみ出させない）', () => {
    const lines = parseScrapbox(['table:t', ` ${'a'.repeat(200)}`].join('\n'))

    expect(rowOf(lines, 1).columns).toEqual([40])
  })

  it('桁割りは CSS の grid-template-columns として渡す', () => {
    const lines = parseScrapbox(SAMPLE)

    // 上限だけを決めた桁にする（狭い画面で枠からはみ出させない）
    expect(tableColumns(lines[1]!)).toBe(
      'minmax(0, calc(10 * 0.5em + 1.25rem))' +
        ' minmax(0, calc(4 * 0.5em + 1.25rem))' +
        ' minmax(0, calc(4 * 0.5em + 1.25rem))',
    )
    expect(tableColumns(lines[0]!)).toBeNull()
  })
})

describe('表の表示', () => {
  it('セルごとに要素を出す', () => {
    const lines = parseScrapbox(SAMPLE)

    expect(renderLine(lines[1]!)).toBe(
      '<span class="sb-table__cell">日付</span>' +
        '<span class="sb-table__cell">左</span>' +
        '<span class="sb-table__cell">右</span>',
    )
  })

  it('空のセルでも高さを保つ', () => {
    const lines = parseScrapbox(['table:t', ' a\t\tb'].join('\n'))

    expect(renderLine(lines[1]!)).toContain('<span class="sb-table__cell">&nbsp;</span>')
  })

  it('`table:` は行頭なので、名前だけを出す', () => {
    expect(renderLine(parseScrapbox(SAMPLE)[0]!)).toBe(
      '<span class="sb-table__name">サイズ</span>',
    )
  })
})

/**
 * 行頭の引き継ぎ（`Enter`）と、1段外す（`Backspace`）。
 * `code:` と同じく、続きの行がもう1つの表にならないようにする。
 */
describe('表の行頭', () => {
  it('`table:` の行で改行すると、表の中の行になる', () => {
    const header = parseScrapbox(SAMPLE)[0]!

    expect(continuationPrefix(header)).toBe(' ')
  })

  it('表の行で改行すると、同じ字下げのままになる', () => {
    const row = parseScrapbox(SAMPLE)[2]!

    expect(continuationPrefix(row)).toBe('\t')
  })

  it('行頭の `table:` は、まとめて1段として外す', () => {
    expect(dropPrefixUnit(' table:')).toBe(' ')
  })
})
