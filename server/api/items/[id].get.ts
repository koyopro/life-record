import { asc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import { assertUuid, toItemDto, toSectionDto } from '~~/server/utils/items'
import type { ItemDetailDto } from '~~/shared/types/item'

/** Item の詳細。紐づく Section を時系列で含める。 */
export default defineEventHandler(async (event): Promise<ItemDetailDto> => {
  const id = assertUuid(getRouterParam(event, 'id'))
  const db = useDb()

  const [item] = await db.select().from(items).where(eq(items.id, id))
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: '見つかりません' })
  }

  const rows = await db
    .select()
    .from(sections)
    .where(eq(sections.itemId, id))
    // 新しい日付を上に。同じ日付の中は position 順（docs/03-functional-spec.md 3.1）
    .orderBy(sections.date, asc(sections.position), asc(sections.createdAt))

  const ordered = [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.position - b.position
  })

  return {
    ...toItemDto(item, ordered[0]?.body ?? null),
    sections: ordered.map(toSectionDto),
  }
})
