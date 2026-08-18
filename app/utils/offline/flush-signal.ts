/**
 * 「送るものが増えた」ことを送信エンジンへ知らせるだけの合図。
 *
 * ローカルへ書き込む側（useItemStore）と、送る側（useSync）を直接つながずに
 * おくために置く。互いに呼び合うと、composable が入れ子で自分自身を
 * 呼び出してしまうため。
 */

let handler: (() => void) | null = null

/** 送信エンジンが自分を登録する。 */
export function onFlushRequested(fn: () => void): void {
  handler = fn
}

/** ローカルへ書いた側が呼ぶ。エンジンがまだ動いていなければ何もしない。 */
export function requestFlush(): void {
  handler?.()
}
