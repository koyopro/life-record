import { describe, expect, it } from 'vitest'
import { firstImageSrc, parseScrapbox } from '~~/shared/utils/scrapbox/parse'

const GYAZO_ID = '733b193a4485f26c8acc45d03b412c8f'

/**
 * Scrapbox 同様、Gyazo の共有ページ URL を画像として扱う
 * （docs/11-scrapbox-notation.md）。`gyazo.com/<id>` はHTMLページなので、
 * 画像の実体である `i.gyazo.com/<id>.png` に直してから src にする。
 */
describe('Gyazo の画像リンク', () => {
  it('[https://gyazo.com/<id>] は i.gyazo.com の画像 URL になる', () => {
    const [line] = parseScrapbox(`[https://gyazo.com/${GYAZO_ID}]`)
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([
      { type: 'image', src: `https://i.gyazo.com/${GYAZO_ID}.png`, large: false },
    ])
  })

  it('[https://i.gyazo.com/<id>]（拡張子なし）も png を仮定する', () => {
    const [line] = parseScrapbox(`[https://i.gyazo.com/${GYAZO_ID}]`)
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([
      { type: 'image', src: `https://i.gyazo.com/${GYAZO_ID}.png`, large: false },
    ])
  })

  it('拡張子が分かっているものはそのまま使う', () => {
    const [line] = parseScrapbox(`[https://i.gyazo.com/${GYAZO_ID}.jpg]`)
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([
      { type: 'image', src: `https://i.gyazo.com/${GYAZO_ID}.jpg`, large: false },
    ])
  })

  it('[[https://gyazo.com/<id>]]（横幅いっぱい）でも同様に直す', () => {
    const [line] = parseScrapbox(`[[https://gyazo.com/${GYAZO_ID}]]`)
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([
      { type: 'image', src: `https://i.gyazo.com/${GYAZO_ID}.png`, large: true },
    ])
  })

  it('日記一覧のプレビューでも、直した画像 URL が取れる', () => {
    expect(firstImageSrc(`メモ\n[https://gyazo.com/${GYAZO_ID}]\n続き`)).toBe(
      `https://i.gyazo.com/${GYAZO_ID}.png`,
    )
  })
})
