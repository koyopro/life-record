import type { ItemDto } from '~~/shared/types/item'

/**
 * 日記の「この日にやったこと」の並べ方（app/pages/diary/[date].vue が使う）。
 *
 * その日の作業記録を持つ Item を**タグごとにまとめて**出す
 * （docs/03-functional-spec.md 3.3）。1日を振り返るときに見たいのは
 * 「何に時間を使ったか」なので、いまの状態（完了かどうか）よりタグで
 * まとまっている方が読み取りやすい。
 */

/** その日にやったこと1件。Item と、その日の作業記録の本文。 */
export interface WorkedOnRecord {
  item: ItemDto
  body: string
}

export interface WorkedOnGroup {
  /** タグ名。タグの付いていない Item のグループは null。 */
  tag: string | null
  records: WorkedOnRecord[]
}

/** タグの付いていない Item をまとめるグループの名前。 */
export const UNTAGGED_TITLE = 'タグなし'

/**
 * タグごとにまとめる。
 *
 * **作業メモの無い Item は出さない。**日記に並べたいのは「何をしたか」で、
 * 記録の枠だけがあって中身の無いものは読み返す手がかりにならないため。
 *
 * **複数のタグが付いた Item は、そのすべてのグループに出す。**「このタグで
 * 何をしたか」を見るのが目的なので、片方のタグからだけ見えないと取りこぼす。
 *
 * **タグの付いていないものが先頭**で、その後ろにタグ名順のグループを並べる。
 * タグを付けていない作業は分類の手がかりが無く、下に置くと埋もれるため。
 * 各グループの中は、渡された順（更新の新しい順）のまま。
 */
export function groupWorkedOn(records: WorkedOnRecord[]): WorkedOnGroup[] {
  const byTag = new Map<string, WorkedOnRecord[]>()
  const untagged: WorkedOnRecord[] = []

  for (const record of records) {
    if (!record.body.trim()) continue

    if (record.item.tags.length === 0) {
      untagged.push(record)
      continue
    }
    for (const tag of record.item.tags) {
      const group = byTag.get(tag) ?? []
      group.push(record)
      byTag.set(tag, group)
    }
  }

  const tagged: WorkedOnGroup[] = [...byTag.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([tag, group]) => ({ tag, records: group }))

  return untagged.length > 0 ? [{ tag: null, records: untagged }, ...tagged] : tagged
}
