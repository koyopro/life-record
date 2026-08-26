/**
 * カレンダー上の日付（YYYY-MM-DD）を扱う。
 *
 * `Section.date` と `Diary.date` はどちらも時刻を持たない「その日」であり、
 * Date へ直すとタイムゾーンで前後の日にずれる。文字列のまま扱う。
 */

/**
 * アプリケーション全体のタイムゾーン。
 * 個人利用のため固定とする（docs/08-todo-management.md 8.5）。
 */
export const APP_TIME_ZONE = 'Asia/Tokyo'

const APP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// en-CA は YYYY-MM-DD 形式を返す
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * 指定時刻の「アプリのタイムゾーンにおける日付」を YYYY-MM-DD で返す。
 *
 * Section.date / Diary.date はカレンダー上の日付であり、実行環境の
 * タイムゾーンとはずれうるため、必ずこの関数を通す。
 */
export function toAppDate(at: Date = new Date()): string {
  return dateFormatter.format(at)
}

/**
 * アプリ日付（`YYYY-MM-DD`）の終わり（23:59:59.999）。
 *
 * 「期限がその日まで」の絞り込みに使う。実行環境のタイムゾーンに
 * 依存しないよう、オフセットを明示して組み立てる。
 * Asia/Tokyo はサマータイムがないため +09:00 固定でよい。
 */
export function endOfDate(date: string): Date {
  return new Date(`${date}T23:59:59.999+09:00`)
}

/**
 * その日の終わり（23:59:59.999）を、アプリのタイムゾーンで返す。
 *
 * 「いま」から数えるとき用。日付そのものを持っている（`useToday` など）
 * ときは endOfDate に渡す。そちらは日付が変われば数え直せる。
 */
export function endOfAppDay(at: Date = new Date()): Date {
  return endOfDate(toAppDate(at))
}

/**
 * その日の始まり（00:00:00.000）を、アプリのタイムゾーンで返す。
 *
 * 「今日完了したもの」のように、範囲で絞り込むときに endOfAppDay と対で使う。
 */
export function startOfAppDay(at: Date = new Date()): Date {
  return new Date(`${toAppDate(at)}T00:00:00.000+09:00`)
}

/**
 * 「今日」を期限として保存するときの値。
 *
 * 時刻の指定がない期限は 23:59 とする決まりなので、
 * SmartAdd が `^今日` を解釈したときと同じ値にそろえる
 * （docs/08-todo-management.md 8.5）。
 */
export function todayDueAt(at: Date = new Date()): Date {
  return new Date(`${toAppDate(at)}T23:59:00.000+09:00`)
}

/** YYYY-MM-DD の形をしていて、実在する日付か。 */
export function isAppDate(value: unknown): value is string {
  if (typeof value !== 'string' || !APP_DATE_PATTERN.test(value)) return false

  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  // 2026-02-31 のような存在しない日付を弾く
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/** 日付を days 日ずらす。 */
export function shiftAppDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

/** 曜日の並び。カレンダーの見出しにも使うので、日曜始まりで持つ。 */
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 曜日（日〜土）。 */
export function weekdayOf(date: string): string {
  return WEEKDAYS[weekdayIndexOf(date)]!
}

/** 表示用の日付（2026/08/18(火)）。 */
export function formatAppDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${year}/${month}/${day}(${weekdayOf(date)})`
}

/** 表示用の日付（8月18日(火)）。年をまたがない範囲で使う。 */
export function formatAppDateShort(date: string): string {
  const [, month, day] = date.split('-') as [string, string, string]
  return `${Number(month)}月${Number(day)}日(${weekdayOf(date)})`
}

// --- 月（YYYY-MM） -------------------------------------------------------
//
// 日記の一覧はカレンダー表示のため、月を単位に扱う
// （docs/03-functional-spec.md 3.3）。日付と同じく、時刻を持たない
// カレンダー上の月として文字列のまま扱う。

const APP_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** YYYY-MM の形をしているか。 */
export function isAppMonth(value: unknown): value is string {
  return typeof value === 'string' && APP_MONTH_PATTERN.test(value)
}

/** その日付が属する月。 */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** 月を months ヶ月ずらす。 */
export function shiftAppMonth(month: string, months: number): string {
  const [year, index] = month.split('-').map(Number) as [number, number]
  const shifted = new Date(Date.UTC(year, index - 1 + months, 1))
  return shifted.toISOString().slice(0, 7)
}

/** その月の初日。 */
export function firstDayOfMonth(month: string): string {
  return `${month}-01`
}

/** その月の末日。月ごとの日数と閏年は Date に任せる。 */
export function lastDayOfMonth(month: string): string {
  const [year, index] = month.split('-').map(Number) as [number, number]
  // 翌月の0日目＝当月の末日
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10)
}

/** 表示用の月（2026年8月）。 */
export function formatAppMonth(month: string): string {
  const [year, index] = month.split('-') as [string, string]
  return `${year}年${Number(index)}月`
}

/**
 * カレンダーに並べる日付。日曜始まりの7の倍数で返す。
 *
 * 前後の月の日も含める。週の途中で欄が欠けると、曜日の列がずれて
 * カレンダーとして読めなくなるため。
 */
export function monthGrid(month: string): string[] {
  const first = firstDayOfMonth(month)
  const last = lastDayOfMonth(month)

  const start = shiftAppDate(first, -weekdayIndexOf(first))
  const end = shiftAppDate(last, 6 - weekdayIndexOf(last))

  const dates: string[] = []
  for (let date = start; date <= end; date = shiftAppDate(date, 1)) {
    dates.push(date)
  }
  return dates
}

/** 曜日の番号（日曜が 0）。 */
function weekdayIndexOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}
