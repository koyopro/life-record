import type { ItemStatus } from '~~/shared/types/item'
import type { ListView } from '~~/shared/types/smart-list'
import { endOfDate } from '~~/shared/utils/date'

/** 数えるのに要るのはこれだけ。手元の Item（LocalItem）をそのまま渡せる。 */
export interface CountableItem {
  status: ItemStatus
  tags: string[]
  /** 期限。「今日」のように期限で絞る一覧でだけ見る。 */
  dueAt?: string | null
  /** 同期の状態。消して、まだ送れていないものは数えない。 */
  syncState?: string
}

/** 数える対象を決める条件。スマートリスト（SmartListDto）をそのまま渡せる。 */
export interface CountableList {
  tag: string | null
  view: ListView
  /**
   * 期限がここまでのものだけを数える（「今日」）。
   *
   * 「いま」ではなく境目そのものを受け取る。呼ぶ側（袖）は表示中の日付を
   * 持っているので、開いたまま日付をまたいでも数え直せる。
   */
  dueUntil?: Date | null
}

/**
 * 一覧に当てはまる件数（袖に出す数字）。
 *
 * **押した先に並ぶ数と一致させる**。タグの件数が未完了のものだけを数えている
 * のと同じ考え方で（docs/09-tags.md 9.3）、リストは自分の表示方法（未完了 /
 * 完了 / すべて）を持っているので、そちらに合わせて数える。既定の「未完了」で
 * 作ったリストなら、そのまま未完了の件数になる。
 *
 * 数えるのは手元（IndexedDB）の Item。サーバーに件数を作らせないのは、
 * オフラインでも一覧そのものが手元の Item から作られている（docs/12-offline.md
 * 12.4）ため。同じ元から数えれば、繋がっていない間も数字と中身がずれない。
 *
 * 条件は `useItemList` の `belongsHere` と同じものを並べる。ずれると、
 * 数字と押した先の中身が食い違う。
 */
export function countList(items: CountableItem[], list: CountableList): number {
  let count = 0

  for (const item of items) {
    // 削除して、まだ送れていないもの（一覧にも出していない）
    if (item.syncState === 'pending_delete') continue

    if (list.view === 'open' && item.status === 'closed') continue
    if (list.view === 'completed' && item.status !== 'closed') continue
    if (list.tag && !item.tags.includes(list.tag)) continue

    if (list.dueUntil) {
      // 期限のないものは「今日やること」ではない
      if (!item.dueAt) continue
      if (new Date(item.dueAt) > list.dueUntil) continue
    }

    count += 1
  }

  return count
}

/**
 * 「今日」の件数。`date` はアプリ日付（`YYYY-MM-DD`）。
 *
 * 押した先（`/today`）が開いたときに出しているのと同じ、**期限がその日までに
 * 来ている未完了**のタスクを数える。完了側（`h`）は「今日終えたこと」という
 * 別の軸で絞るが、袖の数字は開いた直後に並ぶものと合わせる。
 */
export function countToday(items: CountableItem[], date: string): number {
  return countList(items, { tag: null, view: 'open', dueUntil: endOfDate(date) })
}
