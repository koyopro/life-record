/**
 * クリップボードへ書く。書けたかどうかを返す。
 *
 * 呼ぶのは打鍵・クリックの流れの中だけにする。ブラウザは操作の直後しか
 * 書き込みを許さないため、間に await を挟むと拒まれることがある。
 *
 * 使えないのは安全なコンテキストでないとき（http でのアクセスなど）と、
 * 権限を拒まれたとき。どちらも画面から知らせたいので、投げずに false を返す。
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
