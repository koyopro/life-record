/**
 * サーバーへの送信を1本の列にまとめる。
 *
 * 画面はローカルへ先に反映して先へ進むため、送信は後追いになる。
 * 並行に投げると、続けざまの操作（完了にしてすぐ取り消す、追加した直後に
 * 重要度を変える）が投げた順に届かず、最後に書かれる値が入れ替わる。
 *
 * 呼び出しは常にユーザー操作の後（クライアント）なので、
 * モジュールに1本だけ持つ。
 */
let queue: Promise<unknown> = Promise.resolve()

/**
 * 前の送信が終わってから task を実行する。
 *
 * 前が失敗しても止めない。1つの操作の失敗は、その操作の中で
 * 打ち消す（ローカルの変更を取り消す）ことになっているため。
 */
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const running = queue.then(task, task)
  queue = running.catch(() => undefined)
  return running
}
