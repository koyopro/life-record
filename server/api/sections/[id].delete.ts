import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { sections } from '~~/server/db/schema'
import { assertUuid } from '~~/server/utils/items'

/** Section を削除する。 */
export default defineEventHandler(async (event) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'Section ID')

  const db = useDb()
  const deleted = await db
    .delete(sections)
    .where(eq(sections.id, id))
    .returning({ id: sections.id })

  if (deleted.length === 0) {
    throw createError({ statusCode: 404, statusMessage: '見つかりません' })
  }

  setResponseStatus(event, 204)
  return null
})
