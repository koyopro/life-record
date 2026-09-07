import { describe, expect, it } from 'vitest'
import { itemDto } from './helpers'
import { replaceNthOccurrence, resolveTodoLink } from '~/utils/todo-link'
import { itemLinkText } from '~/utils/item-link'
import { parseScrapbox } from '~~/shared/utils/scrapbox/parse'
import { renderLine } from '~~/shared/utils/scrapbox/render'

/**
 * 本文から TODO を指すインラインリンク（docs/11-scrapbox-notation.md 11.13）。
 *
 * `[題]` は**リンク先の決まっていない**リンクで、押したときに手元の TODO から
 * 引き当て、決まったら `[/items/<id> 題]` へ書き換える。
 */

function nodesOf(input: string) {
  const [line] = parseScrapbox(input)
  if (line!.type !== 'text') throw new Error('unreachable')
  return line!.nodes
}

function html(input: string) {
  const [line] = parseScrapbox(input)
  return renderLine(line!)
}

describe('`[題]` の記法', () => {
  it('書かれたままの文字列を持つ（決まったときに書き換えるため）', () => {
    expect(nodesOf('今日は[メダリスト]を進めた')).toEqual([
      { type: 'text', value: '今日は' },
      { type: 'pageLink', title: 'メダリスト', raw: '[メダリスト]' },
      { type: 'text', value: 'を進めた' },
    ])
  })

  it('押せるように出す。題は data 属性にも入れる', () => {
    const output = html('[メダリスト]')
    expect(output).toContain('class="sb-page-link sb-page-link--todo"')
    expect(output).toContain('data-todo-text="メダリスト"')
    expect(output).toContain('data-todo-raw="[メダリスト]"')
    expect(output).toContain('>メダリスト</button>')
  })

  it('アプリ内のパスの書き損じ（`[/…]`）は押せるようにしない', () => {
    expect(html('[/items/not-a-uuid]')).toBe(
      '<span class="sb-page-link">/items/not-a-uuid</span>',
    )
  })

  it('題はエスケープしてから属性に入れる', () => {
    const output = html('[<script>alert(1)</script>]')
    expect(output).not.toContain('<script>')
    expect(output).toContain('&lt;script&gt;')
  })

  it('コードの中では記法として扱わない', () => {
    expect(nodesOf('`[メダリスト]`')).toEqual([{ type: 'code', value: '[メダリスト]' }])
  })
})

describe('リンク先の引き当て', () => {
  const closed = itemDto({ title: 'メダリスト', status: 'closed' })
  const open = itemDto({ title: 'メダリスト', updatedAt: '2026-09-01T00:00:00.000Z' })
  const other = itemDto({ title: 'メルカリ' })

  it('同じ題が1件だけなら、それをリンク先にできる', () => {
    const match = resolveTodoLink([closed, other], 'メダリスト')
    expect(match).toEqual({ kind: 'one', item: closed })
  })

  it('前後の空白と英字の大小は無視する', () => {
    const item = itemDto({ title: 'Medalist' })
    expect(resolveTodoLink([item], ' medalist ')).toEqual({ kind: 'one', item })
  })

  it('同じ題が複数あれば、決め打ちにせず候補を返す', () => {
    const match = resolveTodoLink([closed, open, other], 'メダリスト')
    if (match.kind !== 'many') throw new Error('候補が返るはず')
    // 選ぶのは利用者。並びだけ、未完了を先にして選びやすくする
    expect(match.items).toEqual([open, closed])
  })

  it('同じ題が無ければ none（新しく作るかを尋ねる）', () => {
    expect(resolveTodoLink([other], 'メダリスト')).toEqual({ kind: 'none' })
  })

  it('消す途中のものは、もう無いものとして扱う', () => {
    const removing = { ...closed, syncState: 'pending_delete' }
    expect(resolveTodoLink([removing], 'メダリスト')).toEqual({ kind: 'none' })
  })
})

describe('リンク先が決まったときの書き換え', () => {
  const id = '11111111-1111-4111-8111-111111111111'

  it('`[題]` を `[/items/<id> 題]` にする', () => {
    const line = '今日は[メダリスト]を進めた'
    expect(
      replaceNthOccurrence(line, '[メダリスト]', 0, itemLinkText({ id, title: 'メダリスト' })),
    ).toBe(`今日は[/items/${id} メダリスト]を進めた`)
  })

  it('同じ行に同じリンクが並んでいても、押したものだけを変える', () => {
    const line = '[メダリスト]と[メダリスト]'
    expect(replaceNthOccurrence(line, '[メダリスト]', 1, '[X]')).toBe('[メダリスト]と[X]')
  })

  it('見つからなければ何も変えない（書いている途中で本文が変わった場合）', () => {
    expect(replaceNthOccurrence('本文', '[メダリスト]', 0, '[X]')).toBe('本文')
    expect(replaceNthOccurrence('[メダリスト]', '[メダリスト]', 3, '[X]')).toBe('[メダリスト]')
  })
})
