import { APP_TIME_ZONE } from '~~/shared/utils/date'

/**
 * サーバー側の日付計算を Asia/Tokyo に固定する。
 *
 * Vercel の実行環境は UTC のため、これを入れないと「明日」などの
 * 相対日付の解釈が日本時間とずれる（docs/08-todo-management.md 8.5）。
 */
export default defineNitroPlugin(() => {
  process.env.TZ ??= APP_TIME_ZONE
})
