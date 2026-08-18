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

    // 削除前に控えておく。Undo で元のタグごと戻すため。
    const removedTags = (await tagsByItemId(tx, [id])).get(id) ?? []

    const [removed] = await tx
      .delete(items)
      .where(eq(items.id, id))
      .returning()

    if (!removed) {
      throw createError({ statusCode: 404, message: '見つかりません' })
    }

    const ordered = [...removedSections].sort(compareSectionsForDisplay)
    const primary = [...removedSections].sort(comparePrimarySection)[0] ?? null

    return {
      ...toItemDto(removed, primary?.body ?? null, removedTags),
      sections: ordered.map(toSectionDto),
      primarySectionId: primary?.id ?? null,
    }
  })
})
