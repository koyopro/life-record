import type { NewSmartList, SmartList } from '~~/server/db/schema'
import { isGroupKey, isSortKey } from '~~/shared/types/item'
import {
  isDueOperator,
  isDueOperatorBare,
  isListView,
  type DueCondition,
  type SmartListDto,
  type SmartListInput,
} from '~~/shared/types/smart-list'

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
    due: toDueCondition(row),
    view: isListView(row.view) ? row.view : 'open',
    groupBy: isGroupKey(row.groupBy) ? row.groupBy : 'none',
    sort: isSortKey(row.sort) ? row.sort : 'priorityDueDesc',
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * 期限の条件を2列（向き・式）から組み立てる。
 *
 * 読めない向きや、式が要るのに空のときは「絞り込まない」に寄せる。
 * 表示方法などと同じで、1件のせいでリストごと開けなくなるより、
 * 絞らずに開けるほうがよい。
 */
function toDueCondition(row: SmartList): DueCondition | null {
  if (!isDueOperator(row.dueOperator)) return null
  if (isDueOperatorBare(row.dueOperator)) {
    return { operator: row.dueOperator, value: '' }
  }
  const value = row.dueValue?.trim()
  return value ? { operator: row.dueOperator, value } : null
}

/** 画面から受け取った中身を、保存する行の形にする（期限は2列に分ける）。 */
export function toSmartListRow(input: SmartListInput): NewSmartList {
  const { due, ...rest } = input
  return {
    ...rest,
    dueOperator: due?.operator ?? null,
    dueValue: due && !isDueOperatorBare(due.operator) ? due.value : null,
  }
}
