import { desc, eq, inArray } from 'drizzle-orm'
import type { Executor } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import { toItemDtos } from '~~/server/utils/items'
import type { ItemDto } from '~~/shared/types/item'

/**
 * その日に作業した Item を引く（docs/02-data-model.md 2.7）。
 *
 * Diary と Section は直接の関連を持たず、同じ日付であることだけで結び付く。
 */
export async function itemsWorkedOn(
  db: Executor,
  date: string,
): Promise<ItemDto[]> {
  const rows = await db
    .selectDistinct({ id: sections.itemId })
    .from(sections)
    .where(eq(sections.date, date))

  const ids = rows.map((row) => row.id)
  if (ids.length === 0) return []

  const found = await db
    .select()
    .from(items)
    .where(inArray(items.id, ids))
    .orderBy(desc(items.updatedAt))

  return await toItemDtos(db, found)
}
