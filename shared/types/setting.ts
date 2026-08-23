/**
 * 画面の設定（docs/15-client-state.md 14.7）。
 *
 * 一覧の並び・グループ順のような「その人の見え方」を、鍵と値だけの
 * 小さな対応表として持つ。中身の意味は使う側（`useItemList` など）が決め、
 * サーバーは文字列として預かるだけ。項目が増えても API は変えずに済む。
 */
export type SettingsDto = Record<string, string>

export const SETTING_KEY_MAX_LENGTH = 100
export const SETTING_VALUE_MAX_LENGTH = 500

/** 1回の保存で送れる件数。まとめて送るのは画面ごとの並びぶん程度。 */
export const SETTING_KEYS_MAX = 50

/** 一覧の並びを覚える鍵。画面ごとに分ける。 */
export function sortSettingKey(screen: string): string {
  return `sort:${screen}`
}

/** 一覧のグループ順を覚える鍵。並びと対にする。 */
export function groupSettingKey(screen: string): string {
  return `sort:${screen}:group`
}
