import { describe, expect, it } from 'vitest'
import { DUE_PRESETS, matchDuePresets } from '~/utils/due'
import { parseDueExpression } from '~~/shared/utils/smart-add'

/** 候補の並び順そのものが挙動（`Enter` で確定するのは先頭）なので、名前の列で見る。 */
function labels(text: string): string[] {
  return matchDuePresets(text).map((preset) => preset.label)
}

describe('期限の候補', () => {
  it('英語の頭文字だけで絞り込める', () => {
    // `tod` `tom` + Enter で確定できること。先頭に来ているかまで見る
    expect(labels('tod')[0]).toBe('今日')
    expect(labels('tom')[0]).toBe('明日')
    expect(labels('today')).toEqual(['今日'])
    expect(labels('tomorrow')).toEqual(['明日'])
  })

  it('日本語でも同じように絞り込める', () => {
    expect(labels('明日')).toEqual(['明日'])
    expect(labels('きょ')).toEqual(['今日'])
    expect(labels('来週')).toEqual(['来週', '来週末'])
  })

  it('大文字小文字は区別しない', () => {
    expect(labels('TOM')).toEqual(['明日'])
  })

  it('入力が空なら全部の候補を出す', () => {
    expect(matchDuePresets('')).toEqual(DUE_PRESETS)
    expect(matchDuePresets('  ')).toEqual(DUE_PRESETS)
  })

  it('候補に無い書き方は絞り込まれない（入力そのものを解釈する側に回す）', () => {
    expect(labels('8/25')).toEqual([])
    expect(labels('zzz')).toEqual([])
  })

  it('「なし」は期限を外す候補として出る', () => {
    expect(labels('none')).toEqual(['期限なし'])
    expect(labels('x')).toEqual(['期限なし'])
  })

  it('すべての候補が日付として解釈できる', () => {
    // 候補に出しておきながら選ぶと何も起きない、という状態を作らない
    for (const preset of DUE_PRESETS) {
      expect(parseDueExpression(preset.expression), preset.label).not.toBeNull()
    }
  })
})

/**
 * 曜日での指定（docs/08-todo-management.md 8.5 日付のパース）。
 *
 * 今日と同じ曜日を書いたときは、次の同じ曜日（7日後）にする。今日のことなら
 * 「今日」と書くので、曜日で書くのは次のその曜日のつもりのため。
 */
describe('曜日の指定', () => {
  /** 2026-08-24 は月曜。 */
  const monday = new Date(2026, 7, 24, 10, 0, 0)

  function dueDate(text: string, reference = monday): Date {
    const result = parseDueExpression(text, reference)
    if (!result || result.cleared) throw new Error(`解釈できなかった: ${text}`)
    return result.date
  }

  it('今日と同じ曜日は、次の同じ曜日（7日後）', () => {
    expect(dueDate('月曜').getDate()).toBe(31)
    expect(dueDate('月曜日').getDate()).toBe(31)
    expect(dueDate('monday').getDate()).toBe(31)
  })

  it('時刻を添えても同じ（次の同じ曜日の、その時刻）', () => {
    const due = dueDate('月曜 15時')
    expect(due.getDate()).toBe(31)
    expect(due.getHours()).toBe(15)
  })

  it('別の曜日は、いちばん近い先の日のまま', () => {
    expect(dueDate('火曜').getDate()).toBe(25)
    expect(dueDate('日曜').getDate()).toBe(30)
  })

  it('日付で書いたものは動かさない（今日を指していてもそのまま）', () => {
    expect(dueDate('今日').getDate()).toBe(24)
    expect(dueDate('8/24').getDate()).toBe(24)
  })

  it('「来週の月曜」は、来週の月曜のまま（さらに1週ずらさない）', () => {
    expect(dueDate('来週の月曜').getDate()).toBe(31)
  })
})
