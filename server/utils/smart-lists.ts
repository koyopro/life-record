import type { SmartList } from '~~/server/db/schema'
import { isGroupKey, isSortKey } from '~~/shared/types/item'
import { isListView, type SmartListDto } from '~~/shared/types/smart-list'

/**
 * 保存してある行を、そのまま画面へ渡せる形にする。
 *
 * 表示方法・グループ順・並びは text で持っているため、読めない値
 * （名前を変えた後の古い行）は既定へ寄せる。1件のせいでリストごと
 * 開けなくなるより、既定の見え方で開けるほうがよい。
 */
export function toSmartListDto(row: SmartList): SmartListDto {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    view: isListView(row.view) ? row.view : 'open',
    groupBy: isGroupKey(row.groupBy) ? row.groupBy : 'none',
    sort: isSortKey(row.sort) ? row.sort : 'priorityDueDesc',
    createdAt: row.createdAt.toISOString(),
  }
}
