import { describe, expect, it } from 'vitest'
import { groupWorkedOn } from '~/utils/diary-worked-on'
import type { ItemDto, ItemStatus } from '~~/shared/types/item'

/**
 * 日記の「この日にやったこと」を、完了したものとそれ以外に分ける
 * （app/pages/diary/[date].vue が表示に使う）。
 */

function fakeItem(overrides: Partial<ItemDto> & { id: string }): ItemDto {
  const status: ItemStatus = overrides.status ?? 'closed'
  return {
    title: 'タイトル',
    status,
    priority: null,
    url: null,
    dueAt: null,
    dueHasTime: false,
    body: null,
    tags: [],
    recurrenceRule: null,
    recurrenceBasis: null,
    seriesId: null,
    completedAt: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  }
}

describe('groupWorkedOn', () => {
  it('その日に完了した Item は「完了した」グループに入る', () => {
    const item = fakeItem({
      id: 'item-1',
      status: 'closed',
      completedAt: '2026-08-18T10:00:00.000+09:00',
    })

    const groups = groupWorkedOn([item], '2026-08-18')

    expect(groups).toEqual([
      { title: 'この日に完了したTODO', items: [item] },
    ])
  })

  it('完了していない Item は「作業した」グループに入る', () => {
    const item = fakeItem({ id: 'item-1', status: 'in_progress', completedAt: null })

    const groups = groupWorkedOn([item], '2026-08-18')

    expect(groups).toEqual([
      { title: 'この日に作業したTODO', items: [item] },
    ])
  })

  it('別の日に完了した Item は「作業した」グループに入る', () => {
    const item = fakeItem({
      id: 'item-1',
      status: 'closed',
      completedAt: '2026-08-17T23:59:00.000+09:00',
    })

    const groups = groupWorkedOn([item], '2026-08-18')

    expect(groups).toEqual([
      { title: 'この日に作業したTODO', items: [item] },
    ])
  })

  it('完了とそれ以外が混ざるときは両方のグループを返す', () => {
    const completed = fakeItem({
      id: 'item-1',
      status: 'closed',
      completedAt: '2026-08-18T10:00:00.000+09:00',
    })
    const inProgress = fakeItem({ id: 'item-2', status: 'in_progress', completedAt: null })

    const groups = groupWorkedOn([completed, inProgress], '2026-08-18')

    expect(groups).toEqual([
      { title: 'この日に完了したTODO', items: [completed] },
      { title: 'この日に作業したTODO', items: [inProgress] },
    ])
  })

  it('該当する Item が無いグループは返さない', () => {
    expect(groupWorkedOn([], '2026-08-18')).toEqual([])
  })
})
