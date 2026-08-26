import { describe, expect, it } from 'vitest'
import { countList, countToday, type CountableItem } from '~/utils/list-count'

/**
 * 袖に出す件数（「今日」・スマートリスト。docs/08-todo-management.md 8.6）。
 * 押した先の一覧に並ぶ数と一致させる。
 */
function item(overrides: Partial<CountableItem> = {}): CountableItem {
  return { status: 'backlog', tags: [], ...overrides }
}

describe('countList', () => {
  it('未完了のリストは、完了したものを数えない', () => {
    const items = [
      item(),
      item({ status: 'doing' }),
      item({ status: 'closed' }),
    ]

    expect(countList(items, { tag: null, view: 'open' })).toBe(2)
  })

  it('完了のリストは、完了したものだけを数える', () => {
    const items = [item(), item({ status: 'closed' })]

    expect(countList(items, { tag: null, view: 'completed' })).toBe(1)
  })

  it('すべてのリストは状態を見ない', () => {
    const items = [item(), item({ status: 'closed' })]

    expect(countList(items, { tag: null, view: 'all' })).toBe(2)
  })

  it('タグで絞っているリストは、そのタグが付いたものだけ', () => {
    const items = [
      item({ tags: ['仕事'] }),
      item({ tags: ['仕事', '学び'] }),
      item({ tags: ['暮らし'] }),
      item(),
    ]

    expect(countList(items, { tag: '仕事', view: 'open' })).toBe(2)
  })

  it('消して、まだ送れていないものは数えない', () => {
    const items = [item(), item({ syncState: 'pending_delete' })]

    expect(countList(items, { tag: null, view: 'open' })).toBe(1)
  })

  it('当てはまるものが無ければ 0', () => {
    expect(countList([], { tag: null, view: 'open' })).toBe(0)
  })
})

/**
 * 「今日」の件数。押した先（`/today`）が開いたときに並ぶのと同じ、
 * 期限がその日までに来ている未完了のタスクを数える。
 */
describe('countToday', () => {
  /** その日の 23:59（時刻の指定がない期限と同じ値）。 */
  const dueOn = (date: string) => `${date}T23:59:00.000+09:00`

  it('期限が今日までに来ている未完了のものを数える', () => {
    const items = [
      item({ dueAt: dueOn('2026-08-25') }), // 過ぎている
      item({ dueAt: dueOn('2026-08-26') }), // 今日
      item({ dueAt: dueOn('2026-08-27') }), // まだ先
    ]

    expect(countToday(items, '2026-08-26')).toBe(2)
  })

  it('期限のないものは数えない', () => {
    const items = [item({ dueAt: null }), item({ dueAt: dueOn('2026-08-26') })]

    expect(countToday(items, '2026-08-26')).toBe(1)
  })

  it('完了したものは数えない', () => {
    const items = [
      item({ dueAt: dueOn('2026-08-26') }),
      item({ status: 'closed', dueAt: dueOn('2026-08-26') }),
    ]

    expect(countToday(items, '2026-08-26')).toBe(1)
  })

  it('日付が変われば、その日までのものを数え直す', () => {
    const items = [item({ dueAt: dueOn('2026-08-27') })]

    expect(countToday(items, '2026-08-26')).toBe(0)
    expect(countToday(items, '2026-08-27')).toBe(1)
  })
})
