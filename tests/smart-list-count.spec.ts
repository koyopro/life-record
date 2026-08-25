import { describe, expect, it } from 'vitest'
import { countSmartList, type CountableItem } from '~/utils/smart-list-count'

/**
 * 袖に出すリストの件数（docs/08-todo-management.md 8.6）。
 * 押した先（そのリストの一覧）に並ぶ数と一致させる。
 */
function item(overrides: Partial<CountableItem> = {}): CountableItem {
  return { status: 'backlog', tags: [], ...overrides }
}

describe('countSmartList', () => {
  it('未完了のリストは、完了したものを数えない', () => {
    const items = [
      item(),
      item({ status: 'doing' }),
      item({ status: 'closed' }),
    ]

    expect(countSmartList(items, { tag: null, view: 'open' })).toBe(2)
  })

  it('完了のリストは、完了したものだけを数える', () => {
    const items = [item(), item({ status: 'closed' })]

    expect(countSmartList(items, { tag: null, view: 'completed' })).toBe(1)
  })

  it('すべてのリストは状態を見ない', () => {
    const items = [item(), item({ status: 'closed' })]

    expect(countSmartList(items, { tag: null, view: 'all' })).toBe(2)
  })

  it('タグで絞っているリストは、そのタグが付いたものだけ', () => {
    const items = [
      item({ tags: ['仕事'] }),
      item({ tags: ['仕事', '学び'] }),
      item({ tags: ['暮らし'] }),
      item(),
    ]

    expect(countSmartList(items, { tag: '仕事', view: 'open' })).toBe(2)
  })

  it('消して、まだ送れていないものは数えない', () => {
    const items = [item(), item({ syncState: 'pending_delete' })]

    expect(countSmartList(items, { tag: null, view: 'open' })).toBe(1)
  })

  it('当てはまるものが無ければ 0', () => {
    expect(countSmartList([], { tag: null, view: 'open' })).toBe(0)
  })
})
