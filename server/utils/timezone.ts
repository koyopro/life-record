import { APP_TIME_ZONE } from '~~/shared/utils/date'

/**
 * 実行環境の時計をアプリのタイムゾーン（Asia/Tokyo）に固定する。
 *
 * 期限の解釈（`^` の後ろの日付）は、入力中のプレビューと保存結果が食い違わない
 * よう、**サーバーとクライアントで同じコードを動かす**決まりにしている
 * （docs/08-todo-management.md 8.5）。同じコードでも、動かす場所の時計が違えば
 * 結果は変わる。日付だけの指定は「その日の 23:59」をその場の時計で組み立てる
 * ため、UTC で動かすと日本時間の翌朝 8:59 になり、**期限が1日ずれる**。
 *
 * **必ず上書きする。**「未設定なら入れる」（`??=`）では効かない。Vercel の
 * 実行環境（AWS Lambda）は `TZ` を `:UTC` として渡してくるので、設定済みと
 * みなされて UTC のまま残る。
 */
export function applyAppTimeZone(
  env: Record<string, string | undefined> = process.env,
): void {
  env.TZ = APP_TIME_ZONE
}
