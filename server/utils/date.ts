/**
 * アプリケーション全体のタイムゾーン。
 * 個人利用のため固定とする（docs/08-todo-management.md 8.5）。
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

/**
 * その日の終わり（23:59:59.999）を、アプリのタイムゾーンで返す。
 *
 * 「期限が今日まで」の絞り込みに使う。実行環境のタイムゾーンに
 * 依存しないよう、オフセットを明示して組み立てる。
 * Asia/Tokyo はサマータイムがないため +09:00 固定でよい。
 */
export function endOfAppDay(at: Date = new Date()): Date {
  return new Date(`${toAppDate(at)}T23:59:59.999+09:00`)
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
