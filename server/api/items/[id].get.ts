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
import type { Fetched } from '~~/shared/types/fetched'
import { fetched } from '~~/server/utils/fetched'

/**
 * Item の詳細。紐づく Section を時系列で含める。
 *
 * 手元の控え（IndexedDB）と突き合わせるので、応答を作った時刻を添えて返す
 * （`fetched`。docs/15-client-state.md 14.2 の 4）。
 */
export default defineEventHandler(
  async (event): Promise<Fetched<ItemDetailDto>> => {
    const id = assertUuid(getRouterParam(event, 'id'))
    const db = useDb()

    return await fetched(async () => {
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
        sections: ordered.map(toSectionDto),
        primarySectionId: primary?.id ?? null,
      }
    })
  },
)
