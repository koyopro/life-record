import { describe, expect, it } from 'vitest'
import {
  describeRecurrence,
  nextDueAt,
  parseRecurrence,
} from '~~/shared/utils/recurrence'

/**
 * 月の中の並びで決まる繰り返し（docs/10-recurrence.md 10.7）。
 *
 * RTM の「オン: 最後の・平日」に当たるもの。どの曜日かではなく、その月の
 * 何番目かで日が決まる（月末が土日なら、その前の金曜になる）。
 */
describe('毎月の最後の平日', () => {
  it('曜日の組（平日）と、その中の何番目か（BYSETPOS）で表す', () => {
    expect(parseRecurrence('毎月の最後の平日')).toEqual({
      rule: 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      basis: 'due',
    })
  })

  it('「最終」や「の」の有無、英語でも同じ規則になる', () => {
    const expected = 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'
    expect(parseRecurrence('毎月最終平日')?.rule).toBe(expected)
    expect(parseRecurrence('毎月最後の平日')?.rule).toBe(expected)
    expect(parseRecurrence('every month on the last weekday')?.rule).toBe(expected)
  })

  it('月末が土日なら、その前の平日へ寄る', () => {
    const recurrence = parseRecurrence('毎月の最後の平日')!
    // 2026-10-31 は土曜。前へ寄って 10/30（金）になる
    const from = new Date('2026-09-30T23:59:00+09:00')

    const next = nextDueAt(recurrence, from, from)

    expect(next?.getFullYear()).toBe(2026)
    expect(next?.getMonth()).toBe(9)
    expect(next?.getDate()).toBe(30)
    // 期限の時刻（23:59）は保つ
    expect(next?.getHours()).toBe(23)
    expect(next?.getMinutes()).toBe(59)
  })

  it('月末が平日なら、その日になる', () => {
    const recurrence = parseRecurrence('毎月の最後の平日')!
    const from = new Date('2026-11-30T23:59:00+09:00')

    const next = nextDueAt(recurrence, from, from)

    // 2026-12-31 は木曜
    expect(next?.getMonth()).toBe(11)
    expect(next?.getDate()).toBe(31)
  })
})

describe('月の中の並びで決まる指定', () => {
  it('曜日が1つなら、BYDAY に序数を付けた形にする', () => {
    expect(parseRecurrence('毎月の第2月曜')?.rule).toBe('FREQ=MONTHLY;BYDAY=2MO')
    expect(parseRecurrence('毎月の最後の金曜')?.rule).toBe('FREQ=MONTHLY;BYDAY=-1FR')
  })

  it('間隔（2ヶ月ごと）も付けられる', () => {
    expect(parseRecurrence('2ヶ月ごとの最後の平日')?.rule).toBe(
      'FREQ=MONTHLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
    )
  })

  it('月に無い並び（6番目）は受け付けない', () => {
    expect(parseRecurrence('毎月の6番目の平日')).toBeNull()
  })

  it('並びの指定が無ければ、これまでどおりの解釈のまま', () => {
    expect(parseRecurrence('毎月15日')?.rule).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
    expect(parseRecurrence('毎週月曜')?.rule).toBe('FREQ=WEEKLY;BYDAY=MO')
  })
})

/**
 * 書き戻した文がそのまま読めること。
 *
 * 設定ダイアログは、いまの設定を文にしてから入力欄へ入れる。読めない文を
 * 出すと、開き直しただけで設定を失う（RTM から取り込んだ規則がそれだった）。
 */
describe('表示と解釈の往復', () => {
  const cases = [
    ['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '毎月の最後の平日'],
    ['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1', '毎月の最初の平日'],
    ['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2', '毎月の最後から2番目の平日'],
    ['FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=-1', '毎月の最後の週末'],
    ['FREQ=MONTHLY;BYDAY=2MO', '毎月の第2月曜'],
    ['FREQ=MONTHLY;BYDAY=-1FR', '毎月の最後の金曜'],
    ['FREQ=MONTHLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2ヶ月ごとの最後の平日'],
  ] as const

  it.each(cases)('%s → %s → 同じ規則に戻る', (rule, text) => {
    const recurrence = { rule, basis: 'due' } as const

    expect(describeRecurrence(recurrence)).toBe(text)
    expect(parseRecurrence(text)?.rule).toBe(rule)
  })

  it('RTM の書き出し（INTERVAL=1 付き）も同じ言い方になる', () => {
    expect(
      describeRecurrence({
        rule: 'FREQ=MONTHLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
        basis: 'due',
      }),
    ).toBe('毎月の最後の平日')
  })
})
