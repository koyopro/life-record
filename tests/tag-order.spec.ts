import { describe, expect, it } from 'vitest'
import { PICKER_TAG_COLORS, TAG_COLORS, type TagColor } from '~~/shared/types/tag'
import {
  TAG_COLOR_SORT_ORDER,
  moveInList,
  orderByNames,
  sortByColorGroup,
} from '~~/shared/utils/tag-order'

/** タグの並べ替え（docs/09-tags.md 9.3「並べ替え」）。 */
describe('sortByColorGroup', () => {
  const tag = (name: string, color: TagColor | null) => ({ name, color })

  it('色相順に、濃い色を淡い色の前に置き、色なしを最後にする', () => {
    const sorted = sortByColorGroup([
      tag('none', null),
      tag('blue-pale', 'rtm-blue-pale'),
      tag('red-pale', 'rtm-red-pale'),
      tag('blue', 'rtm-blue'),
      tag('red', 'rtm-red'),
      tag('teal', 'teal'),
    ])
    expect(sorted.map((t) => t.name)).toEqual(['red', 'red-pale', 'teal', 'blue', 'blue-pale', 'none'])
  })

  it('同じ色どうしは今の並びを保つ', () => {
    const sorted = sortByColorGroup([
      tag('z', 'rtm-red'),
      tag('x', null),
      tag('a', 'rtm-red'),
      tag('y', null),
    ])
    expect(sorted.map((t) => t.name)).toEqual(['z', 'a', 'x', 'y'])
  })

  it('すべての色に順番がある', () => {
    expect([...TAG_COLOR_SORT_ORDER].sort()).toEqual([...TAG_COLORS].sort())
  })

  it('色見本に出す色は、色見本と同じ順に並ぶ', () => {
    const picked = TAG_COLOR_SORT_ORDER.filter((c) => (PICKER_TAG_COLORS as readonly string[]).includes(c))
    expect(picked).toEqual([...PICKER_TAG_COLORS])
  })
})

describe('moveInList', () => {
  it('前後へ動かす', () => {
    expect(moveInList(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveInList(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b'])
  })

  it('範囲外は動かさない', () => {
    expect(moveInList(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveInList(['a', 'b'], 1, 2)).toEqual(['a', 'b'])
  })
})

describe('orderByNames', () => {
  const tags = ['a', 'b', 'c', 'd'].map((name) => ({ name }))

  it('指定した名前を先頭に、残りは今の順で続ける', () => {
    expect(orderByNames(tags, ['c', 'a']).map((t) => t.name)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('知らない名前と重複は無視する', () => {
    expect(orderByNames(tags, ['x', 'b', 'b']).map((t) => t.name)).toEqual(['b', 'a', 'c', 'd'])
  })
})
