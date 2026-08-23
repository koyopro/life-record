import { describe, expect, it } from 'vitest'
import { sortItems } from '~/utils/item-order'
import { toSortKey } from '~~/shared/types/item'
import { itemDto } from './helpers'

/**
 * 一覧の並び（docs/08-todo-management.md 8.2）。
 *
 * ここでの期待値は、サーバーの ORDER BY（server/utils/items.ts の
 * `orderByFor`）と同じ順序であること。ずれていると、追加や重要度の変更を
 * 手元で反映した位置と、取り直した後の位置が食い違って行が飛ぶ。
 */

/** 期限と重要度だけを指定した Item。並びに関わるものだけを見る。 */
function item(id: string, due: string | null, priority: 1 | 2 | 3 | null = null) {
  return itemDto({ id, dueAt: due, priority, createdAt: `2026-01-01T00:00:00.000Z` })
}

describe('sortItems', () => {
  it('重要度順は、同じ重要度の中で期限の新しいものが上', () => {
    const sorted = sortItems(
      [
        item('古い期限', '2026-08-01T00:00:00.000Z', 1),
        item('新しい期限', '2026-08-20T00:00:00.000Z', 1),
        item('重要度が低い', '2026-08-30T00:00:00.000Z', 3),
      ],
      'priorityDueDesc',
    )

    expect(sorted.map((i) => i.id)).toEqual([
      '新しい期限',
      '古い期限',
      '重要度が低い',
    ])
  })

  it('期限なしは、昇順でも降順でも末尾', () => {
    const items = [
      item('期限なし', null),
      item('古い', '2026-08-01T00:00:00.000Z'),
      item('新しい', '2026-08-20T00:00:00.000Z'),
    ]

    expect(sortItems(items, 'due').map((i) => i.id)).toEqual([
      '古い',
      '新しい',
      '期限なし',
    ])
    expect(sortItems(items, 'dueDesc').map((i) => i.id)).toEqual([
      '新しい',
      '古い',
      '期限なし',
    ])
  })

  it('追加日降順は、後から追加したものが上', () => {
    const sorted = sortItems(
      [
        itemDto({ id: '古い', createdAt: '2026-08-01T00:00:00.000Z' }),
        itemDto({ id: '新しい', createdAt: '2026-08-20T00:00:00.000Z' }),
      ],
      'created',
    )

    expect(sorted.map((i) => i.id)).toEqual(['新しい', '古い'])
  })
})

describe('toSortKey', () => {
  it('いまの軸はそのまま読む', () => {
    expect(toSortKey('dueDesc')).toBe('dueDesc')
  })

  it('無くした「重要度順（期限が近い順）」は、いまの重要度順へ寄せる', () => {
    expect(toSortKey('priority')).toBe('priorityDueDesc')
  })

  it('読み替え先の無いものは null（画面の既定に戻す）', () => {
    expect(toSortKey('title')).toBeNull()
    expect(toSortKey(null)).toBeNull()
  })
})
