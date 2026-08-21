import { describe, expect, it } from 'vitest'
import type { SectionDto } from '~~/shared/types/item'
import {
  nextPositionIn,
  pickPrimarySection,
  sortSectionsForDisplay,
} from '~/utils/section-order'

/**
 * Section の並びは、ストアが編集を即座に反映するためにクライアントでも
 * 計算する（docs/15-client-state.md）。サーバー（server/utils/items.ts）と
 * 同じ結果にならないと、取り直したときに記録が飛んで見える。
 */

function section(values: Partial<SectionDto> & { id: string }): SectionDto {
  return {
    date: '2026-08-20',
    body: '',
    position: 0,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...values,
  }
}

describe('sortSectionsForDisplay', () => {
  it('日付は新しい順、同じ日付の中は position 昇順', () => {
    const sorted = sortSectionsForDisplay([
      section({ id: 'c', date: '2026-08-19', position: 0 }),
      section({ id: 'b', date: '2026-08-20', position: 1 }),
      section({ id: 'a', date: '2026-08-20', position: 0 }),
    ])

    expect(sorted.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('元の配列は変えない', () => {
    const list = [
      section({ id: 'b', date: '2026-08-19' }),
      section({ id: 'a', date: '2026-08-20' }),
    ]
    sortSectionsForDisplay(list)
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
  })
})

describe('pickPrimarySection', () => {
  it('最初に作られたものを本文にする', () => {
    const primary = pickPrimarySection([
      section({ id: 'new', createdAt: '2026-08-20T10:00:00.000Z' }),
      section({ id: 'old', createdAt: '2026-08-19T10:00:00.000Z' }),
    ])

    expect(primary?.id).toBe('old')
  })

  it('作成時刻が同じなら position、それも同じなら id で決める', () => {
    const primary = pickPrimarySection([
      section({ id: 'b', position: 1 }),
      section({ id: 'a', position: 1 }),
      section({ id: 'c', position: 0 }),
    ])

    expect(primary?.id).toBe('c')
  })

  it('1件も無ければ null', () => {
    expect(pickPrimarySection([])).toBeNull()
  })
})

describe('nextPositionIn', () => {
  it('同じ日付の末尾に置く', () => {
    const list = [
      section({ id: 'a', date: '2026-08-20', position: 0 }),
      section({ id: 'b', date: '2026-08-20', position: 1 }),
      section({ id: 'c', date: '2026-08-19', position: 5 }),
    ]

    expect(nextPositionIn(list, '2026-08-20')).toBe(2)
  })

  it('その日にまだ記録が無ければ 0', () => {
    expect(nextPositionIn([section({ id: 'a', date: '2026-08-20' })], '2026-08-21')).toBe(0)
  })
})
