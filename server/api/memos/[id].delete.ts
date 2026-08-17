import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items } from '~~/server/db/schema'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** メモを削除する。紐づく Section は ON DELETE CASCADE で消える。 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id || !UUID_PATTERN.test(id)) {
    throw createError({ statusCode: 400, statusMessage: '不正なIDです' })
  }

  const db = useDb()
  const deleted = await db
    .delete(items)
    .where(eq(items.id, id))
    .returning({ id: items.id })

  if (deleted.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'メモが見つかりません',
    })
  }

  setResponseStatus(event, 204)
  return null
})
