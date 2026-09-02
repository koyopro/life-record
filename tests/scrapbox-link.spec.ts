import { describe, expect, it } from 'vitest'
import { parseScrapbox } from '~~/shared/utils/scrapbox/parse'
import { renderInline } from '~~/shared/utils/scrapbox/render'

/**
 * 日記とタスクの本文で相互にリンクを書くための、アプリ内パスの記法
 * （docs/11-scrapbox-notation.md「アプリ内のページへのリンク」）。
 *
 * `[/images/xxx]`（画像リンク）と同じ、角括弧＋アプリの相対パスの形。
 */
describe('アプリ内のページへのリンク', () => {
  const ITEM_ID = '93179db9-bbe9-4c3c-87e9-0fd385a281f9'

  it('[/items/<uuid>] はタスクへのリンクになる', () => {
    const [line] = parseScrapbox(`[/items/${ITEM_ID}]`)
    expect(line!.type).toBe('text')
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([
      { type: 'link', href: `/items/${ITEM_ID}`, nodes: [{ type: 'text', value: `/items/${ITEM_ID}` }] },
    ])
  })

  it('[/items/<uuid> タイトル] は表示文字列つきのリンクになる', () => {
    const [line] = parseScrapbox(`[/items/${ITEM_ID} 買い物リストを作る]`)
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([
      {
        type: 'link',
        href: `/items/${ITEM_ID}`,
        nodes: [{ type: 'text', value: '買い物リストを作る' }],
      },
    ])
  })

  it('uuid の形をしていない id はリンクにしない', () => {
    const [line] = parseScrapbox('[/items/not-a-uuid]')
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([{ type: 'pageLink', title: '/items/not-a-uuid' }])
  })

  it('[/diary/YYYY-MM-DD] は日記へのリンクになる', () => {
    const [line] = parseScrapbox('[/diary/2026-08-19 今日の日記]')
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([
      {
        type: 'link',
        href: '/diary/2026-08-19',
        nodes: [{ type: 'text', value: '今日の日記' }],
      },
    ])
  })

  it('実在しない日付はリンクにしない', () => {
    const [line] = parseScrapbox('[/diary/2026-02-31]')
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([{ type: 'pageLink', title: '/diary/2026-02-31' }])
  })

  it('[/diary/month/YYYY-MM] は月のページへのリンクになる', () => {
    const [line] = parseScrapbox('[/diary/month/2026-09 9月の振り返り]')
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([
      {
        type: 'link',
        href: '/diary/month/2026-09',
        nodes: [{ type: 'text', value: '9月の振り返り' }],
      },
    ])
  })

  it('月のページのリンクは、表示文字列なしでも書ける', () => {
    const [line] = parseScrapbox('[/diary/month/2026-09]')
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([
      {
        type: 'link',
        href: '/diary/month/2026-09',
        nodes: [{ type: 'text', value: '/diary/month/2026-09' }],
      },
    ])
  })

  it('ありえない月はリンクにしない', () => {
    const [line] = parseScrapbox('[/diary/month/2026-13]')
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([{ type: 'pageLink', title: '/diary/month/2026-13' }])
  })

  /*
   * 月のページを `/diary/2026-09` にしなかった理由そのもの。この形なら、
   * 月を指しているものを本文から部分一致で引いても（バックリンク）、
   * その月の日記リンクを巻き込まない。
   */
  it('月のリンクは、その月の日記リンクの前方一致にならない', () => {
    expect('/diary/2026-09-01'.includes('/diary/month/2026-09')).toBe(false)
  })

  it('月を日付の位置に書いても、日記のリンクにはならない', () => {
    const [line] = parseScrapbox('[/diary/2026-09]')
    if (line!.type !== 'text') throw new Error('unreachable')
    expect(line!.nodes).toEqual([{ type: 'pageLink', title: '/diary/2026-09' }])
  })

  it('レンダリングすると、同じタブで開く内部リンクとして出る', () => {
    const [line] = parseScrapbox(`[/items/${ITEM_ID} タスクへ]`)
    if (line!.type !== 'text') throw new Error('unreachable')
    const html = renderInline(line!.nodes)
    expect(html).toContain(`href="/items/${ITEM_ID}"`)
    expect(html).toContain('sb-link--internal')
    expect(html).not.toContain('target="_blank"')
  })

  it('外部リンクは今まで通り新しいタブで開く', () => {
    const [line] = parseScrapbox('[https://example.com 外部]')
    if (line!.type !== 'text') throw new Error('unreachable')
    const html = renderInline(line!.nodes)
    expect(html).toContain('target="_blank"')
    expect(html).not.toContain('sb-link--internal')
  })
})
