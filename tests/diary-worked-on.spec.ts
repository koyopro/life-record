import { describe, expect, it } from 'vitest'
import { groupWorkedOn, type WorkedOnRecord } from '~/utils/diary-worked-on'
import { headOf, pinnedImageOf } from '~~/shared/utils/diary'
import type { ItemDto } from '~~/shared/types/item'

/**
 * 日記の「この日にやったこと」の出し方
 * （docs/03-functional-spec.md 3.3。app/pages/diary/[date].vue が表示に使う）。
 */

function record(
  overrides: Partial<ItemDto> & { id: string },
  body = '作業メモ',
): WorkedOnRecord {
  return {
    item: {
      title: 'タイトル',
      status: 'backlog',
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
    },
    body,
  }
}

describe('groupWorkedOn', () => {
  it('タグごとにまとめる', () => {
    const work = record({ id: 'item-1', tags: ['仕事'] })
    const life = record({ id: 'item-2', tags: ['暮らし'] })

    expect(groupWorkedOn([work, life])).toEqual([
      { tag: '仕事', records: [work] },
      { tag: '暮らし', records: [life] },
    ])
  })

  it('タグが複数付いた Item は、そのすべてのグループに出す', () => {
    const both = record({ id: 'item-1', tags: ['仕事', '学び'] })

    expect(groupWorkedOn([both])).toEqual([
      { tag: '仕事', records: [both] },
      { tag: '学び', records: [both] },
    ])
  })

  it('タグの付いていない Item は、先頭のグループにまとめる', () => {
    const tagged = record({ id: 'item-1', tags: ['仕事'] })
    const bare = record({ id: 'item-2' })

    expect(groupWorkedOn([tagged, bare])).toEqual([
      { tag: null, records: [bare] },
      { tag: '仕事', records: [tagged] },
    ])
  })

  it('グループの中は渡された順（更新の新しい順）のまま', () => {
    const first = record({ id: 'item-1', tags: ['仕事'] })
    const second = record({ id: 'item-2', tags: ['仕事'] })

    expect(groupWorkedOn([first, second])[0]?.records).toEqual([first, second])
  })

  it('作業メモの無い Item は出さない', () => {
    const written = record({ id: 'item-1', tags: ['仕事'] })
    const blank = record({ id: 'item-2', tags: ['仕事'] }, '')
    const spaces = record({ id: 'item-3', tags: ['仕事'] }, ' \n ')

    expect(groupWorkedOn([written, blank, spaces])).toEqual([
      { tag: '仕事', records: [written] },
    ])
  })

  it('作業メモがある Item がいなければ、そのグループごと出さない', () => {
    expect(groupWorkedOn([record({ id: 'item-1', tags: ['仕事'] }, '')])).toEqual([])
  })

  it('何も無ければグループも無い', () => {
    expect(groupWorkedOn([])).toEqual([])
  })

  // --- ピン留め（docs/03-functional-spec.md 3.3） -------------------------

  it('ピン留めしたものは、いちばん上のグループにまとめる', () => {
    const pinned = { ...record({ id: 'item-1', tags: ['仕事'] }), pinned: true }
    const other = record({ id: 'item-2', tags: ['仕事'] })

    expect(groupWorkedOn([pinned, other])).toEqual([
      { tag: null, pinned: true, records: [pinned] },
      { tag: '仕事', records: [other] },
    ])
  })

  it('ピン留めは1日に何件でも。渡された順（上に出る順）のまま並べる', () => {
    const first = { ...record({ id: 'item-1' }), pinned: true }
    const second = { ...record({ id: 'item-2', tags: ['仕事'] }), pinned: true }

    expect(groupWorkedOn([first, second])).toEqual([
      { tag: null, pinned: true, records: [first, second] },
    ])
  })

  it('ピン留めしたものは、タグのグループには出さない（同じ記録を2か所に出さない）', () => {
    const pinned = { ...record({ id: 'item-1', tags: ['仕事', '学び'] }), pinned: true }

    expect(groupWorkedOn([pinned])).toEqual([
      { tag: null, pinned: true, records: [pinned] },
    ])
  })

  it('ピン留めでも、作業メモが無ければ出さない', () => {
    const blank = { ...record({ id: 'item-1' }, ''), pinned: true }

    expect(groupWorkedOn([blank])).toEqual([])
  })
})

describe('headOf', () => {
  it('冒頭の行だけを返す', () => {
    const body = ['1行目', '2行目', '3行目', '4行目', '5行目', '6行目'].join('\n')

    expect(headOf(body)).toEqual({
      text: ['1行目', '2行目', '3行目', '4行目', '5行目'].join('\n'),
      truncated: true,
    })
  })

  it('行数に収まっていれば、続きは無い', () => {
    expect(headOf('1行目\n2行目')).toEqual({ text: '1行目\n2行目', truncated: false })
  })

  it('記法はそのまま残す（表示側で解釈する）', () => {
    expect(headOf('[* 見出し]\n[https://example.com]').text).toBe(
      '[* 見出し]\n[https://example.com]',
    )
  })

  it('末尾の空行は落とす', () => {
    expect(headOf('1行目\n\n\n')).toEqual({ text: '1行目', truncated: false })
  })

  it('空行だけが続いていても、続きがあるとは言わない', () => {
    expect(headOf(['1', '2', '3', '4', '5', '', ' '].join('\n')).truncated).toBe(false)
  })

  it('行数は指定できる', () => {
    expect(headOf('1\n2\n3', 2)).toEqual({ text: '1\n2', truncated: true })
  })
})

/**
 * カレンダーのサムネイル（docs/03-functional-spec.md 3.3）。
 * 本文に画像が無い日は、ピン留めした作業記録の画像を使う。
 */
describe('pinnedImageOf', () => {
  it('上に出ている作業記録の画像を使う', () => {
    const image = pinnedImageOf([
      '打ち合わせのメモ\n[https://example.com/first.png]',
      '[https://example.com/second.png]',
    ])

    expect(image).toBe('https://example.com/first.png')
  })

  it('画像を持たない記録は飛ばす', () => {
    const image = pinnedImageOf(['文字だけのメモ', '[https://example.com/second.png]'])

    expect(image).toBe('https://example.com/second.png')
  })

  it('どれにも画像が無ければ null', () => {
    expect(pinnedImageOf(['文字だけ', ''])).toBeNull()
    expect(pinnedImageOf([])).toBeNull()
  })
})
