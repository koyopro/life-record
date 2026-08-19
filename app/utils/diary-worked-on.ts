import type { ItemDto } from '~~/shared/types/item'
import { toAppDate } from '~~/shared/utils/date'

/**
 * 日記の「この日にやったこと」の中の1グループ。
 */
export interface WorkedOnGroup {
  title: string
  items: ItemDto[]
}

/**
 * 「この日にやったこと」（その日の Section を持つ Item）を、
 * その日に完了したものと、それ以外（本文・作業記録があるだけ）に分ける。
 *
 * 両方に当てはまる Item は、完了した方のグループにだけ入れる。
 */
export function groupWorkedOn(items: ItemDto[], date: string): WorkedOnGroup[] {
  const completed: ItemDto[] = []
  const others: ItemDto[] = []

  for (const item of items) {
    const completedToday =
      item.completedAt !== null && toAppDate(new Date(item.completedAt)) === date
    ;(completedToday ? completed : others).push(item)
  }

  return [
    { title: 'この日に完了したTODO', items: completed },
    { title: 'この日に作業したTODO', items: others },
  ].filter((group) => group.items.length > 0)
}
