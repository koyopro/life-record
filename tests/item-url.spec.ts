import { describe, expect, it } from 'vitest'
import { describeUrlOpen, openableUrls } from '~/utils/item-url'

describe('openableUrls', () => {
  it('選んだ順のまま、開ける URL だけを返す', () => {
    const found = openableUrls([
      { url: 'https://example.com/1' },
      { url: 'http://example.com/2' },
    ])

    expect(found).toEqual({
      urls: ['https://example.com/1', 'http://example.com/2'],
      withoutUrl: 0,
    })
  })

  it('URL の無いもの・開けない書き方のものは数えて飛ばす', () => {
    const found = openableUrls([
      { url: null },
      { url: '   ' },
      { url: 'example.com' },
      { url: 'javascript:alert(1)' },
      { url: 'https://example.com/1' },
    ])

    expect(found).toEqual({ urls: ['https://example.com/1'], withoutUrl: 4 })
  })

  it('同じ URL は1つにまとめる（開きたいのはページなのでタブも1つ）', () => {
    const found = openableUrls([
      { url: 'https://example.com/1' },
      { url: ' https://example.com/1 ' },
      { url: 'https://example.com/2' },
    ])

    expect(found.urls).toEqual(['https://example.com/1', 'https://example.com/2'])
    expect(found.withoutUrl).toBe(0)
  })

  it('対象が無ければ空', () => {
    expect(openableUrls([])).toEqual({ urls: [], withoutUrl: 0 })
  })
})

describe('describeUrlOpen', () => {
  it('1件なら件数を出さない', () => {
    expect(describeUrlOpen({ urls: ['https://example.com/1'], withoutUrl: 0 })).toBe(
      'URL を開いた',
    )
  })

  it('複数件は開いた数を出す', () => {
    expect(
      describeUrlOpen({
        urls: ['https://example.com/1', 'https://example.com/2'],
        withoutUrl: 0,
      }),
    ).toBe('2件の URL を開いた')
  })

  it('飛ばしたものがあれば、その数も伝える（選んだ数とタブの数が合う理由）', () => {
    expect(
      describeUrlOpen({ urls: ['https://example.com/1'], withoutUrl: 2 }),
    ).toBe('URL を開いた・URL の無い2件は飛ばした')
  })

  it('開けるものが1つも無ければ、そう伝える', () => {
    expect(describeUrlOpen({ urls: [], withoutUrl: 1 })).toBe(
      'このタスクに URL はありません',
    )
    expect(describeUrlOpen({ urls: [], withoutUrl: 3 })).toBe(
      'URL のあるタスクがありません',
    )
  })
})
