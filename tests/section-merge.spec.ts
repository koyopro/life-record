import { describe, expect, it } from 'vitest'
import { mergeSections } from '~/utils/section-merge'
import type { SectionDto } from '~~/shared/types/item'

/**
 * サーバーから取り直した作業記録に手元の内容を重ねる
 * （docs/15-client-state.md 14.2 の 4）。
 */
function section(id: string, body: string, updatedAt = '2026-08-22T10:00:00.000Z'): SectionDto {
  return {
    id,
    date: '2026-08-22',
    body,
    position: 0,
    createdAt: '2026-08-22T09:00:00.000Z',
    updatedAt,
  }
}

const serverWins = {
  keepsLocalBody: () => false,
  savedAfterResponse: () => false,
}

describe('作業記録の重ね方', () => {
  it('既定ではサーバーの内容を採る', () => {
    const merged = mergeSections(
      [section('a', '手元で書いた')],
      [section('a', 'サーバーの内容')],
      serverWins,
    )

    expect(merged).toEqual([section('a', 'サーバーの内容')])
  })

  it('手元の方が新しい本文は残す。他の項目はサーバーを採る', () => {
    const merged = mergeSections(
      [section('a', '手元で書いた', '2026-08-22T09:00:00.000Z')],
      [{ ...section('a', 'サーバーの内容'), position: 3 }],
      { ...serverWins, keepsLocalBody: () => true },
    )

    expect(merged[0]).toMatchObject({ body: '手元で書いた', position: 3 })
  })

  it('応答より後に保存した記録は、応答に無くても残す', () => {
    const merged = mergeSections(
      [section('new', '今日の1行目')],
      [],
      { ...serverWins, savedAfterResponse: () => true },
    )

    expect(merged).toEqual([section('new', '今日の1行目')])
  })

  it('応答の方が新しければ、応答に無い記録は落とす（他の端末で消された）', () => {
    const merged = mergeSections([section('gone', '消された記録')], [], serverWins)

    expect(merged).toEqual([])
  })

  it('サーバーにしか無い記録は、そのまま増える', () => {
    const merged = mergeSections([], [section('other', '別の端末で書いた')], serverWins)

    expect(merged).toEqual([section('other', '別の端末で書いた')])
  })
})
