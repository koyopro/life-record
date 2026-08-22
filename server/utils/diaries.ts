import { asc, desc, eq, inArray } from 'drizzle-orm'
import type { Executor } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import { toItemDtos, toSectionDto } from '~~/server/utils/items'
import type { DiarySectionDto } from '~~/shared/types/diary'
import type { ItemDto } from '~~/shared/types/item'

/**
 * その日に作業した Item を引く（docs/02-data-model.md 2.8）。
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

/**
 * その日の作業記録を、Item をまたいで引く。
 *
 * クライアントは「この日にやったこと」を手元の作業記録から作る
 * （docs/12-offline.md 12.4）ため、他の端末で書かれた分もここで渡す。
 */
export async function sectionsOnDate(
  db: Executor,
  date: string,
): Promise<DiarySectionDto[]> {
  const rows = await db
    .select()
    .from(sections)
    .where(eq(sections.date, date))
    .orderBy(asc(sections.position))

  return rows.map((row) => ({ ...toSectionDto(row), itemId: row.itemId }))
}
