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

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 曜日（日〜土）。 */
export function weekdayOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!
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
