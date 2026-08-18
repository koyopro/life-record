// 日付そのものの扱いはクライアントと共通（shared/utils/date.ts）。
// ここに置くのは、サーバーでしか使わない期限まわりの組み立てだけ。
// 再エクスポートはしない。自動インポートで同じ名前が二重に登録されるため。
import { isAppDate } from '~~/shared/utils/date'

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
