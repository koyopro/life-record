import type { ItemStatus } from '~~/shared/types/item'
import type { ListView } from '~~/shared/types/smart-list'

/** 数えるのに要るのはこれだけ。手元の Item（LocalItem）をそのまま渡せる。 */
export interface CountableItem {
  status: ItemStatus
  tags: string[]
  /** 同期の状態。消して、まだ送れていないものは数えない。 */
  syncState?: string
}

/** 数える対象を決める条件。スマートリスト（SmartListDto）をそのまま渡せる。 */
export interface CountableList {
  tag: string | null
  view: ListView
}

/**
 * スマートリストに当てはまる件数（袖に出す数字）。
 *
 * **押した先に並ぶ数と一致させる**。タグの件数が未完了のものだけを数えている
 * のと同じ考え方で（docs/09-tags.md 9.3）、リストは自分の表示方法（未完了 /
 * 完了 / すべて）を持っているので、そちらに合わせて数える。既定の「未完了」で
 * 作ったリストなら、そのまま未完了の件数になる。
 *
 * 数えるのは手元（IndexedDB）の Item。サーバーに件数を作らせないのは、
 * オフラインでも一覧そのものが手元の Item から作られている（docs/12-offline.md
 * 12.4）ため。同じ元から数えれば、繋がっていない間も数字と中身がずれない。
 */
export function countSmartList(items: CountableItem[], list: CountableList): number {
  let count = 0

  for (const item of items) {
    // 削除して、まだ送れていないもの（一覧にも出していない）
    if (item.syncState === 'pending_delete') continue

    if (list.view === 'open' && item.status === 'closed') continue
    if (list.view === 'completed' && item.status !== 'closed') continue
    if (list.tag && !item.tags.includes(list.tag)) continue

    count += 1
  }

  return count
}
