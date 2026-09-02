import { describe, expect, it } from 'vitest'
import {
  DATE_INSERT_REPEAT_MS,
  insertDate,
  type DateInsertState,
} from '~/utils/date-insert'

/**
 * `Ctrl` + `T`（本文へ日付を挿入する）の巡回
 * （docs/11-scrapbox-notation.md 11.11）。
 */
describe('Ctrl + T で入れるもの', () => {
  const DATE = '2026-09-03'
  const DAY_LINK = '[/diary/2026-09-03]'
  const MONTH_LINK = '[/diary/month/2026-09]'

  /** 1回目。カーソル位置へ入れる。 */
  function first(value = '', start = value.length, end = start, now = 1000) {
    return insertDate({ last: null, value, start, end, date: DATE, now })
  }

  /** 続けて押す。前回の結果をそのまま渡す。 */
  function again(
    prev: { value: string; caret: number; state: DateInsertState },
    after = 200,
  ) {
    return insertDate({
      last: prev.state,
      value: prev.value,
      start: prev.caret,
      end: prev.caret,
      date: DATE,
      now: prev.state.at + after,
    })
  }

  it('1回目は日付だけを入れる', () => {
    const result = first('今日は')
    expect(result.value).toBe(`今日は${DATE}`)
    expect(result.caret).toBe(`今日は${DATE}`.length)
  })

  it('2回目で、その日の日記へのリンクになる', () => {
    const result = again(first('今日は'))
    expect(result.value).toBe(`今日は${DAY_LINK}`)
  })

  it('3回目で、その月のページへのリンクになる', () => {
    const result = again(again(first('今日は')))
    expect(result.value).toBe(`今日は${MONTH_LINK}`)
  })

  it('4回目で日付へ戻る。行き過ぎても抜け出せる', () => {
    const result = again(again(again(first('今日は'))))
    expect(result.value).toBe(`今日は${DATE}`)
  })

  it('間が空いたら、続きではなく新しく挿入する', () => {
    const result = again(first(''), DATE_INSERT_REPEAT_MS + 1)
    expect(result.value).toBe(`${DATE}${DATE}`)
  })

  it('カーソルを動かしたら、続きではなく新しく挿入する', () => {
    const prev = first('')
    const result = insertDate({
      last: prev.state,
      value: prev.value,
      // 行頭へ戻してから押した
      start: 0,
      end: 0,
      date: DATE,
      now: prev.state.at + 200,
    })
    expect(result.value).toBe(`${DATE}${DATE}`)
  })

  it('入れたものを書き換えたあとは、続きにしない（書きかけを巻き込まない）', () => {
    const prev = first('')
    // 入れた日付そのものに手を入れた（末尾を1文字消した）
    const edited = prev.value.slice(0, -1)
    const result = insertDate({
      last: prev.state,
      value: edited,
      start: edited.length,
      end: edited.length,
      date: DATE,
      now: prev.state.at + 200,
    })
    // 直した文字を巻き込んで消さず、そのうしろへ新しく入れる
    expect(result.value).toBe(`${edited}${DATE}`)
  })

  it('うしろに文字が続いていても、カーソルがそのままなら続きとみなす', () => {
    const prev = first('', 0, 0)
    const result = insertDate({
      last: prev.state,
      value: `${prev.value}まで`,
      start: prev.caret,
      end: prev.caret,
      date: DATE,
      now: prev.state.at + 200,
    })
    // 入れたものは手つかずのまま。次の形へ差し替える
    expect(result.value).toBe(`${DAY_LINK}まで`)
  })

  it('選択している文字を置き換える', () => {
    const result = first('きのう', 0, 3)
    expect(result.value).toBe(DATE)
  })

  it('差し替えても、カーソルは入れたものの末尾に残る', () => {
    const result = again(first('今日は'))
    expect(result.value.slice(0, result.caret)).toBe(`今日は${DAY_LINK}`)
  })
})
