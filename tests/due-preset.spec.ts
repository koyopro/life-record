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
