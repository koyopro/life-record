import { describe, expect, it } from 'vitest'
import { emojiTriggerAt } from '~/utils/emoji-trigger'

/**
 * `:` の候補を出すかの判定（docs/11-scrapbox-notation.md 11.8）。
 */
describe('emojiTriggerAt', () => {
  it('行頭の `:` では候補を出す', () => {
    expect(emojiTriggerAt(':smi')).toEqual({ start: 0, query: 'smi' })
  })

  it('直前が空白の `:` では候補を出す（全角の空白も）', () => {
    expect(emojiTriggerAt('今日は :smi')).toEqual({ start: 4, query: 'smi' })
    expect(emojiTriggerAt('今日は　:')).toEqual({ start: 4, query: '' })
  })

  it('時刻（9:30）では出さない', () => {
    expect(emojiTriggerAt('9:')).toBeNull()
    expect(emojiTriggerAt('9:30頃行ったら')).toBeNull()
  })

  it('語にくっついた `:` では出さない（URL・見出しなど）', () => {
    expect(emojiTriggerAt('https:')).toBeNull()
    expect(emojiTriggerAt('メモ:')).toBeNull()
  })

  it('`:` の後ろに空白を打ったら閉じる', () => {
    expect(emojiTriggerAt(':smile ')).toBeNull()
  })

  it('`:` が無ければ出さない', () => {
    expect(emojiTriggerAt('今日は')).toBeNull()
  })
})
