import { applyAppTimeZone } from '~~/server/utils/timezone'

/**
 * サーバー側の日付計算を Asia/Tokyo に固定する（`applyAppTimeZone`）。
 *
 * Vercel の実行環境は UTC のため、これを入れないと「明日」などの
 * 相対日付や、日付だけの期限の解釈が日本時間とずれる
 * （docs/08-todo-management.md 8.5）。
 */
export default defineNitroPlugin(() => {
  applyAppTimeZone()
})
