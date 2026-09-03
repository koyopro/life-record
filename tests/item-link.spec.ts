import { describe, expect, it } from 'vitest'
import {
  itemIdFromUrl,
  itemLinkText,
  itemLinkTrigger,
  searchItemsForLink,
} from '~/utils/item-link'
import { itemDto } from './helpers'

/**
 * 本文から他のタスクを指すリンク（docs/11-scrapbox-notation.md 11.4 / 11.11）。
 *
 * 入れ方は3つある（`[` の候補・URL の貼り付け・ドラッグ＆ドロップ）が、
 * できあがるのはどれも同じ `[/items/<id> 題]` というただの本文。
 */

const ID = '11111111-2222-4333-8444-555555555555'

describe('タスクへのリンクの文字列', () => {
  it('パスと題を並べた記法にする', () => {
    expect(itemLinkText({ id: ID, title: '請求書を出す' })).toBe(
      `[/items/${ID} 請求書を出す]`,
    )
  })

  it('題の角括弧は全角へ寄せる（そこでリンクが切れるため）', () => {
    expect(itemLinkText({ id: ID, title: '[重要] 請求書を出す' })).toBe(
      `[/items/${ID} ［重要］ 請求書を出す]`,
    )
  })

  it('題が空ならパスだけにする', () => {
    expect(itemLinkText({ id: ID, title: '   ' })).toBe(`[/items/${ID}]`)
  })
})

describe('`[` の候補を出すか', () => {
  it('`[` に続けて打った文字を検索語にする', () => {
    expect(itemLinkTrigger('きょうは [請求', 9)).toEqual({ start: 5, query: '請求' })
    // 空白を挟んだ語も探せる（題に空白は普通にある）
    expect(itemLinkTrigger('[請求書 を', 6)).toEqual({ start: 0, query: '請求書 を' })
  })

  it('`[` を打っただけでは出さない', () => {
    expect(itemLinkTrigger('[', 1)).toBeNull()
  })

  it('他の記法になったら引っ込める', () => {
    expect(itemLinkTrigger('[* 見出し', 5)).toBeNull()
    expect(itemLinkTrigger('[/diary/2026-09-03', 18)).toBeNull()
    expect(itemLinkTrigger('[[https://gyazo.com/x', 21)).toBeNull()
    expect(itemLinkTrigger('[https://example.com リンク', 25)).toBeNull()
  })

  it('閉じたあとは出さない', () => {
    expect(itemLinkTrigger('[請求書]', 5)).toBeNull()
    // 自動で足された `]` の手前（＝まだこの `[` の中）では出す
    expect(itemLinkTrigger('[請求書]', 4)).toEqual({ start: 0, query: '請求書' })
  })

  it('キャレットより後ろは見ない', () => {
    expect(itemLinkTrigger('[請求 のこと', 3)).toEqual({ start: 0, query: '請求' })
  })
})

describe('候補の並び', () => {
  const old = '2026-08-01T00:00:00.000Z'
  const recent = '2026-09-01T00:00:00.000Z'

  it('前方一致 → 部分一致の順に、未完了を先に、更新の新しい順で出す', () => {
    const items = [
      itemDto({ title: '古い請求書', updatedAt: old }),
      itemDto({ title: '請求書を出す（完了）', status: 'closed', updatedAt: recent }),
      itemDto({ title: '請求書を出す', updatedAt: old }),
      itemDto({ title: '請求書をたしかめる', updatedAt: recent }),
      itemDto({ title: '関係のないタスク', updatedAt: recent }),
    ]

    expect(searchItemsForLink(items, '請求').map((item) => item.title)).toEqual([
      '請求書をたしかめる',
      '請求書を出す',
      '請求書を出す（完了）',
      '古い請求書',
    ])
  })

  it('大文字小文字は区別しない。語が無ければ何も出さない', () => {
    const items = [itemDto({ title: 'Invoice を送る' })]

    expect(searchItemsForLink(items, 'invoice')).toHaveLength(1)
    expect(searchItemsForLink(items, '  ')).toEqual([])
  })

  it('出す数には上限がある', () => {
    const items = Array.from({ length: 20 }, () => itemDto({ title: '請求書' }))
    expect(searchItemsForLink(items, '請求')).toHaveLength(8)
  })
})

describe('貼り付けた URL', () => {
  it('タスクのページなら id を取り出す', () => {
    expect(itemIdFromUrl(`https://life.example.com/items/${ID}`)).toBe(ID)
    expect(itemIdFromUrl(`/items/${ID}`)).toBe(ID)
    // 一覧から開いたときに付く問い合わせや、前後の空白は落とす
    expect(itemIdFromUrl(` https://life.example.com/items/${ID}?list=today \n`)).toBe(ID)
  })

  it('タスクのページでなければ null', () => {
    expect(itemIdFromUrl('https://example.com/items/123')).toBeNull()
    expect(itemIdFromUrl(`/diary/2026-09-03`)).toBeNull()
    // 文章の中に混じっているだけのものは変えない（貼り付けたものだけを扱う）
    expect(itemIdFromUrl(`これ /items/${ID} を見て`)).toBeNull()
  })
})
