import { monthOf } from '~~/shared/utils/date'
import { diaryMonthPath } from '~~/shared/utils/diary-month'

/**
 * `Ctrl` + `T`（本文へ日付を挿入する）の巡回
 * （docs/11-scrapbox-notation.md 11.11）。
 *
 * カーソルを動かさず・間を空けずに押し続けると、入れたものが
 *
 *   日付 → その日の日記へのリンク → その月のページへのリンク → 日付 …
 *
 * と変わっていく。月のリンクを別のキーに割り当てないのは、打つ側が
 * 覚えるものを増やさないため。行き過ぎても、もう一度押せば戻れる。
 *
 * 1回目でリンクにしないのは、日付だけ書きたい場面（期限の覚え書きなど）
 * を主にしているから。
 */

/** 続けて押したとみなす間隔。 */
export const DATE_INSERT_REPEAT_MS = 1500

/** 押すたびに巡る形。 */
export function dateInsertForms(date: string): string[] {
  return [date, `[/diary/${date}]`, `[${diaryMonthPath(monthOf(date))}]`]
}

/** 直前に入れた範囲と、いまどの形か。 */
export interface DateInsertState {
  at: number
  start: number
  end: number
  stage: number
}

export interface DateInsertInput {
  /** 直前の挿入。まだ無いなら null。 */
  last: DateInsertState | null
  /** いまの行の中身。 */
  value: string
  /** 選択範囲（カーソルだけなら start === end）。 */
  start: number
  end: number
  date: string
  now: number
}

export interface DateInsertResult {
  /** 差し替えたあとの行。 */
  value: string
  /** 置いたあとのカーソル位置。 */
  caret: number
  /** 次に押されたときの判断に使う。 */
  state: DateInsertState
}

/**
 * 続きの打鍵とみなせるか。
 *
 * 間を空けず・カーソルを動かさず・入れたものがそのまま残っているとき
 * だけ。1つでも外れたら新しく挿入する（書きかけの文字を巻き込んで
 * 消さないため）。
 */
function isRepeat(input: DateInsertInput, forms: string[]): boolean {
  const { last, value, start, end, now } = input
  if (!last) return false

  return (
    now - last.at <= DATE_INSERT_REPEAT_MS &&
    start === last.end &&
    end === last.end &&
    value.slice(last.start, last.end) === forms[last.stage]
  )
}

export function insertDate(input: DateInsertInput): DateInsertResult {
  const { last, value, start, end, date } = input
  const forms = dateInsertForms(date)
  const repeat = isRepeat(input, forms)

  // 続きなら前に入れたものを置き換え、そうでなければ選択範囲へ入れる
  const from = repeat ? last!.start : start
  const to = repeat ? last!.end : end
  const stage = repeat ? (last!.stage + 1) % forms.length : 0
  const text = forms[stage]!

  const caret = from + text.length
  return {
    value: value.slice(0, from) + text + value.slice(to),
    caret,
    state: { at: input.now, start: from, end: caret, stage },
  }
}
