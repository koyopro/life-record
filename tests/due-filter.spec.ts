import { describe, expect, it } from 'vitest'
import type { DueCondition } from '~~/shared/types/smart-list'
import { matchesDue, withListDefaults } from '~~/shared/utils/smart-list'

/**
 * スマートリストの期限での絞り込み（docs/08-todo-management.md 8.6）。
 *
 * 条件は日付そのものではなく式で持つので、**開いた日を基準に**解釈し直す。
 * ここでは基準日を固定して確かめる。
 */

/** 2026-08-26（水）の昼。 */
const NOW = new Date('2026-08-26T12:00:00+09:00')

/** その日の 23:59（時刻の指定がない期限と同じ値）。 */
const due = (date: string) => `${date}T23:59:00.000+09:00`

function on(operator: DueCondition['operator'], value = '今日'): DueCondition {
  return { operator, value }
}

describe('matchesDue', () => {
  it('条件が無ければ、すべて当てはまる', () => {
    expect(matchesDue(null, null, NOW)).toBe(true)
    expect(matchesDue(due('2026-08-26'), null, NOW)).toBe(true)
  })

  it('以内 … その日まで（過ぎているものも含む）', () => {
    expect(matchesDue(due('2026-08-20'), on('within'), NOW)).toBe(true)
    expect(matchesDue(due('2026-08-26'), on('within'), NOW)).toBe(true)
    expect(matchesDue(due('2026-08-27'), on('within'), NOW)).toBe(false)
  })

  it('と等しい … その日ちょうど', () => {
    expect(matchesDue(due('2026-08-26'), on('on'), NOW)).toBe(true)
    expect(matchesDue(due('2026-08-25'), on('on'), NOW)).toBe(false)
    expect(matchesDue(due('2026-08-27'), on('on'), NOW)).toBe(false)
  })

  it('より前 … その日は含まない（期限切れを拾う）', () => {
    expect(matchesDue(due('2026-08-25'), on('before'), NOW)).toBe(true)
    expect(matchesDue(due('2026-08-26'), on('before'), NOW)).toBe(false)
  })

  it('以降 … その日を含む', () => {
    expect(matchesDue(due('2026-08-26'), on('after'), NOW)).toBe(true)
    expect(matchesDue(due('2026-08-27'), on('after'), NOW)).toBe(true)
    expect(matchesDue(due('2026-08-25'), on('after'), NOW)).toBe(false)
  })

  it('日付で絞る向きでは、期限を決めていないものは当てはまらない', () => {
    for (const operator of ['within', 'on', 'before', 'after'] as const) {
      expect(matchesDue(null, on(operator), NOW)).toBe(false)
    }
  })

  it('は空です / 空ではない … 期限があるかどうかだけを見る', () => {
    expect(matchesDue(null, on('unset'), NOW)).toBe(true)
    expect(matchesDue(due('2026-08-26'), on('unset'), NOW)).toBe(false)
    expect(matchesDue(due('2026-08-26'), on('set'), NOW)).toBe(true)
    expect(matchesDue(null, on('set'), NOW)).toBe(false)
  })

  it('式は開いた日を基準に解釈し直す（「明日」は日をまたげば別の日）', () => {
    const condition = on('on', '明日')
    expect(matchesDue(due('2026-08-27'), condition, NOW)).toBe(true)

    const nextDay = new Date('2026-08-27T12:00:00+09:00')
    expect(matchesDue(due('2026-08-27'), condition, nextDay)).toBe(false)
    expect(matchesDue(due('2026-08-28'), condition, nextDay)).toBe(true)
  })

  /*
   * 1つの条件のせいでリストが空になるより、絞らずに開けるほうがよい
   * （手で書き換えた・記法を変えたときのため）。
   */
  it('読めない式では絞り込まない', () => {
    expect(matchesDue(due('2026-08-26'), on('on', 'いつか'), NOW)).toBe(true)
  })

  it('時刻の指定がある期限も、日付だけで比べる', () => {
    const morning = '2026-08-26T09:00:00.000+09:00'
    expect(matchesDue(morning, on('on'), NOW)).toBe(true)
    expect(matchesDue(morning, on('within'), NOW)).toBe(true)
  })
})

/**
 * リストからの追加に、そのリストの条件を既定として足す。
 * 付けないと、追加した途端にそのリストから消える。
 */
describe('withListDefaults', () => {
  it('タグを足し、「以内」「と等しい」ならその日を期限にする', () => {
    expect(
      withListDefaults('請求書を出す', { tag: '仕事', due: on('within', '金曜') }, NOW),
    ).toBe('請求書を出す ^2026/08/28 #仕事')
  })

  it('「期限なし」のリストでは、期限を付けない', () => {
    expect(withListDefaults('あとで考える', { tag: null, due: on('unset') }, NOW)).toBe(
      'あとで考える ^なし',
    )
  })

  it('書かれている指定は上書きしない', () => {
    expect(
      withListDefaults('請求書を出す ^明日', { tag: null, due: on('on', '金曜') }, NOW),
    ).toBe('請求書を出す ^明日')
  })

  /*
   * 「より前」「以降」「期限あり」は、どの日を入れれば当てはまるのかが
   * 1つに決まらない。勝手に決めると、書いていない期限が入ってしまう。
   */
  it('日を決められない向きでは、期限に手を出さない', () => {
    expect(withListDefaults('積読を崩す', { tag: null, due: on('after', '来週') }, NOW)).toBe(
      '積読を崩す',
    )
  })

  it('条件が無ければそのまま', () => {
    expect(withListDefaults('買い物', { tag: null, due: null }, NOW)).toBe('買い物')
    expect(withListDefaults('買い物', null, NOW)).toBe('買い物')
  })
})
