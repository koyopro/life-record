import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import { assertUuid, toItemDto, toSectionDto } from '~~/server/utils/items'
import type { ItemDetailDto } from '~~/shared/types/item'

/**
 * Item を削除する。紐づく Section は ON DELETE CASCADE で消える。
 *
 * 削除した内容をそのまま返す。クライアントはこれを保持しておき、
 * Undo（`u`）で `POST /api/items/restore` に渡して元に戻す。
 */
export default defineEventHandler(async (event): Promise<ItemDetailDto> => {
  const id = assertUuid(getRouterParam(event, 'id'))
  const db = useDb()

  return await db.transaction(async (tx) => {
    const removedSections = await tx
      .select()
      .from(sections)
      .where(eq(sections.itemId, id))

    const [removed] = await tx
      .delete(items)
      .where(eq(items.id, id))
      .returning()

    if (!removed) {
      throw createError({ statusCode: 404, statusMessage: '見つかりません' })
    }

    const ordered = [...removedSections].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      return a.position - b.position
    })

    return {
      ...toItemDto(removed, ordered[0]?.body ?? null),
      sections: ordered.map(toSectionDto),
    }
  })
})
