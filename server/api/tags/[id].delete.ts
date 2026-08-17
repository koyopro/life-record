import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { tags } from '~~/server/db/schema'
import { assertUuid } from '~~/server/utils/items'

/** タグを削除する。全 Item から外れる（item_tags は CASCADE）。 */
export default defineEventHandler(async (event) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'タグID')

  const db = useDb()
  const deleted = await db
    .delete(tags)
    .where(eq(tags.id, id))
    .returning({ id: tags.id })

  if (deleted.length === 0) {
    throw createError({ statusCode: 404, message: '見つかりません' })
  }

  setResponseStatus(event, 204)
  return null
})
