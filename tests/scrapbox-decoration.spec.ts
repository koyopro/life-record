import { describe, expect, it } from 'vitest'
import { parseScrapbox } from '~~/shared/utils/scrapbox/parse'
import { renderLine } from '~~/shared/utils/scrapbox/render'

/**
 * 文字装飾（docs/11-scrapbox-notation.md 11.3）。
 *
 * Scrapbox は装飾記号をそのまま CSS クラスにするが、このサービスでは
 * 意味を与えた記号だけを解釈する。`&` は目印（色を敷く）。
 */
describe('目印（`[& …]`）', () => {
  it('`&` を目印として読む', () => {
    const line = parseScrapbox('[& ここ]が大事')[0]!

    expect(line).toMatchObject({
      type: 'text',
      nodes: [
        { type: 'decoration', highlight: true, nodes: [{ type: 'text', value: 'ここ' }] },
        { type: 'text', value: 'が大事' },
      ],
    })
  })

  it('目印だけのときは、他の装飾は付けない', () => {
    const line = parseScrapbox('[& ここ]')[0]!

    expect(line).toMatchObject({
      nodes: [
        { type: 'decoration', level: 0, italic: false, strike: false, underline: false },
      ],
    })
  })

  it('他の記号と組み合わせられる', () => {
    expect(parseScrapbox('[&* 強い目印]')[0]).toMatchObject({
      nodes: [{ type: 'decoration', highlight: true, level: 1 }],
    })
  })

  it('表示は目印のクラスを付けた要素にする', () => {
    expect(renderLine(parseScrapbox('[& ここ]')[0]!)).toBe(
      '<span class="sb-deco sb-deco--highlight">ここ</span>',
    )
  })

  it('`&` を書いていなければ目印にしない', () => {
    expect(parseScrapbox('[* 強調]')[0]).toMatchObject({
      nodes: [{ type: 'decoration', highlight: false }],
    })
  })
})
