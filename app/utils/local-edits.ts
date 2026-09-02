/**
 * この端末で直した分を、サーバーから届いた一覧に重ねる
 * （docs/15-client-state.md 14.2 の 4）。
 *
 * タグとスマートリストは IndexedDB を通さず、取り直した内容をそのまま出す。
 * 押したそばから見た目を変えたいので手元へ先に当てるが、**取りに行った後に
 * 直すと、その取り直しの応答が後から届いて直す前に戻る**。
 *
 * そこで「この端末で直した分」を別に持ち、届いた内容より優先する（画面の
 * 設定と同じやり方。14.7）。届いた内容が追いついたら、その分は落とす。
 * 時刻の比べ合いが要らないので、端末の時計にも応答の順番にも左右されない。
 */

/** 直した分。id → 直した項目だけ。 */
export type LocalEdits<T> = Record<string, Partial<T>>

/** 届いた一覧に、直した分を重ねる。 */
export function withLocalEdits<T extends { id: string }>(
  list: T[],
  edits: LocalEdits<T>,
): T[] {
  if (Object.keys(edits).length === 0) return list
  return list.map((row) => {
    const edit = edits[row.id]
    return edit ? { ...row, ...edit } : row
  })
}

/**
 * まだ届いていない分だけを残す。
 *
 * 届いた内容が追いついていれば、その分はもう要らない。重ね続けると、あとから
 * 他の端末で直された内容がいつまでも出なくなる。一覧から消えたものも落とす
 * （重ねる相手が無い）。
 */
export function unappliedEdits<T extends { id: string }>(
  list: T[],
  edits: LocalEdits<T>,
): LocalEdits<T> {
  const next: LocalEdits<T> = {}

  for (const [id, edit] of Object.entries(edits)) {
    const row = list.find((entry) => entry.id === id)
    if (!row || isApplied(row, edit)) continue
    next[id] = edit
  }

  return next
}

/**
 * 直した項目が、届いた内容に入っているか。
 *
 * 入れ子（スマートリストの期限の条件）も見るので、値は JSON にして比べる。
 */
function isApplied<T extends { id: string }>(row: T, edit: Partial<T>): boolean {
  const current = row as Record<string, unknown>
  return Object.entries(edit).every(
    ([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value),
  )
}
