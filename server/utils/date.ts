/**
 * アプリケーション全体のタイムゾーン。
 * 個人利用のため固定とする（docs/08-todo-management.md 8.4）。
 */
export const APP_TIME_ZONE = 'Asia/Tokyo'

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * 指定時刻の「アプリのタイムゾーンにおける日付」を YYYY-MM-DD で返す。
 *
 * Section.date はカレンダー上の日付であり、サーバーの UTC 日付とは
 * ずれうるため、必ずこの関数を通す。
 */
export function toAppDate(at: Date = new Date()): string {
  // en-CA は YYYY-MM-DD 形式を返す
  return dateFormatter.format(at)
}
