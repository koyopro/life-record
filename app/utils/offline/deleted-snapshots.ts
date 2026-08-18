import type { ItemDetailDto } from '~~/shared/types/item'

/**
 * 削除した Item の控え。取り消し（`u`）で元に戻すために持つ。
 *
 * Section まで含めて戻せるのは、サーバーが DELETE の応答で返してくれる
 * この控えがあるときだけ。画面を読み込み直すと消えるが、取り消しの履歴
 * （useUndo）も画面の中だけのものなので釣り合っている。
 */

const snapshots = new Map<string, ItemDetailDto>()

/** 溜め込まないよう、直近のぶんだけ残す。 */
const LIMIT = 20

export function rememberDeleted(snapshot: ItemDetailDto): void {
  snapshots.set(snapshot.id, snapshot)
  while (snapshots.size > LIMIT) {
    const oldest = snapshots.keys().next().value
    if (oldest === undefined) break
    snapshots.delete(oldest)
  }
}

/** 控えを取り出す。取り出したら手放す（戻すのは一度きり）。 */
export function takeDeletedSnapshot(id: string): ItemDetailDto | null {
  const snapshot = snapshots.get(id)
  if (!snapshot) return null
  snapshots.delete(id)
  return snapshot
}
