import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import {
  assertUuid,
  comparePrimarySection,
  compareSectionsForDisplay,
  toItemDto,
  toSectionDto,
} from '~~/server/utils/items'
import { tagsByItemId } from '~~/server/utils/tags'
import type { ItemDetailDto } from '~~/shared/types/item'

/** Item の詳細。紐づく Section を時系列で含める。 */
export default defineEventHandler(async (event): Promise<ItemDetailDto> => {
  const id = assertUuid(getRouterParam(event, 'id'))
  const db = useDb()

  const [item] = await db.select().from(items).where(eq(items.id, id))
  if (!item) {
    throw createError({ statusCode: 404, message: '見つかりません' })
  }

  const rows = await db.select().from(sections).where(eq(sections.itemId, id))

  // 新しい日付を上に。同じ日付の中は position 順（docs/03-functional-spec.md 3.1）
  const ordered = [...rows].sort(compareSectionsForDisplay)
  // 本文に使うのは最初に作られたもの。一覧カードと同じ Section を指す
  const primary = [...rows].sort(comparePrimarySection)[0] ?? null

  const tagNames = await tagsByItemId(db, [id])

  return {
    ...toItemDto(item, primary?.body ?? null, tagNames.get(id) ?? []),
    // 応答を作った時刻。手元の保存より前の応答かを、受け取る側が判断できるようにする
    fetchedAt: new Date().toISOString(),
    sections: ordered.map(toSectionDto),
    primarySectionId: primary?.id ?? null,
  }
})
