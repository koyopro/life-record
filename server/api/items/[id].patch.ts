import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items } from '~~/server/db/schema'
import { toUpdateValues } from '~~/server/utils/item-patch'
import {
  assertUuid,
  firstSectionBodies,
  toItemDto,
} from '~~/server/utils/items'
import type { ItemDto } from '~~/shared/types/item'

/** Item を更新する。指定された項目だけを変更する。 */
export default defineEventHandler(async (event): Promise<ItemDto> => {
  const id = assertUuid(getRouterParam(event, 'id'))
  const values = toUpdateValues(await readBody(event))

  const db = useDb()
  const [updated] = await db
    .update(items)
    .set(values)
    .where(eq(items.id, id))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: '見つかりません' })
  }

  const bodies = await firstSectionBodies(db, [updated.id])
  return toItemDto(updated, bodies.get(updated.id) ?? null)
})
