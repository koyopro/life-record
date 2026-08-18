// 日付そのものの扱いはクライアントと共通（shared/utils/date.ts）。
// ここに置くのは、サーバーでしか使わない期限まわりの組み立てだけ。
// 再エクスポートはしない。自動インポートで同じ名前が二重に登録されるため。
import { isAppDate, toAppDate } from '~~/shared/utils/date'

/**
 * リクエストに含まれる日付（YYYY-MM-DD）を検証して返す。
 * Section.date / Diary.date の入口はすべてここを通す。
 */
export function assertAppDate(value: unknown, label = '日付'): string {
  if (!isAppDate(value)) {
    throw createError({ statusCode: 400, message: `不正な${label}です` })
  }
  return value
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
