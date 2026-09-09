import { describe, expect, it } from 'vitest'
import {
  nextFocusAfterRemoval,
  sortByCompletedAt,
  sortItems,
} from '~/utils/item-order'
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

  it('更新日降順は、直近さわったものが上（追加した順ではない）', () => {
    const sorted = sortItems(
      [
        itemDto({
          id: '古く直した',
          createdAt: '2026-08-20T00:00:00.000Z',
          updatedAt: '2026-08-20T00:00:00.000Z',
        }),
        itemDto({
          id: '直近直した',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        }),
      ],
      'updated',
    )

    expect(sorted.map((i) => i.id)).toEqual(['直近直した', '古く直した'])
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

/**
 * 一覧から消えた Item の代わりに、カーソルを置く先
 * （docs/08-todo-management.md 8.4）。
 *
 * 編集した結果その一覧の条件から外れる（完了にする・タグを外す）ことは多く、
 * そのたびに先頭へ飛ばされると続けて片付けられない。
 */
describe('nextFocusAfterRemoval', () => {
  const list = [itemDto({ id: 'a' }), itemDto({ id: 'b' }), itemDto({ id: 'c' })]

  it('消えたものの下にあったものへ移る', () => {
    expect(nextFocusAfterRemoval(list, 'b', new Set(['a', 'c']))).toBe('c')
  })

  it('下が無ければ、上へ遡る', () => {
    expect(nextFocusAfterRemoval(list, 'c', new Set(['a', 'b']))).toBe('b')
  })

  it('まとめて消えたときは、残っているうちでいちばん近い下', () => {
    // b と c が同時に消えた（一括で完了にした）
    expect(nextFocusAfterRemoval(list, 'b', new Set(['a']))).toBe('a')

    const longer = [...list, itemDto({ id: 'd' })]
    expect(nextFocusAfterRemoval(longer, 'b', new Set(['a', 'd']))).toBe('d')
  })

  it('どれも残っていなければ null', () => {
    expect(nextFocusAfterRemoval(list, 'b', new Set())).toBeNull()
  })

  it('消える前の一覧に無いものは、行き先を決められないので null', () => {
    expect(nextFocusAfterRemoval(list, 'z', new Set(['a', 'b', 'c']))).toBeNull()
  })
})

/**
 * 「未完了 / 完了」の完了側（docs/08-todo-management.md 8.2）。
 *
 * その一覧の並び（重要度順・期限順）は当てない。完了したものについて
 * 知りたいのは**いつ終えたか**で、期限で並べても、さっき片付けたものが
 * どこにあるか分からない。
 */
describe('sortByCompletedAt', () => {
  function done(id: string, completedAt: string | null) {
    return itemDto({
      id,
      status: 'closed',
      completedAt,
      // 期限と重要度は、並びに効かないことを見るために散らしておく
      dueAt: '2026-01-01T00:00:00.000Z',
      priority: 1,
      createdAt: `2026-01-0${id}T00:00:00.000Z`,
    })
  }

  it('完了した順（新しいものが上）に並べる', () => {
    const list = [
      done('1', '2026-09-08T10:00:00.000Z'),
      done('2', '2026-09-09T09:00:00.000Z'),
      done('3', '2026-09-09T12:00:00.000Z'),
    ]

    expect(sortByCompletedAt(list).map((item) => item.id)).toEqual(['3', '2', '1'])
  })

  it('完了日時を持たないものは末尾（この記録より前に完了したもの）', () => {
    const list = [done('1', null), done('2', '2026-09-09T09:00:00.000Z')]

    expect(sortByCompletedAt(list).map((item) => item.id)).toEqual(['2', '1'])
  })

  it('元の配列は変えない', () => {
    const list = [
      done('1', '2026-09-08T10:00:00.000Z'),
      done('2', '2026-09-09T09:00:00.000Z'),
    ]

    sortByCompletedAt(list)

    expect(list.map((item) => item.id)).toEqual(['1', '2'])
  })
})
