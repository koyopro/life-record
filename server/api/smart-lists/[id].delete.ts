import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { smartLists } from '~~/server/db/schema'
import { assertUuid } from '~~/server/utils/items'

/** スマートリストを消す。条件だけの入れ物なので、タスクには影響しない。 */
export default defineEventHandler(async (event) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'リストID')

  const [row] = await useDb()
    .delete(smartLists)
    .where(eq(smartLists.id, id))
    .returning({ id: smartLists.id })

  if (!row) throw createError({ statusCode: 404, message: 'リストが見つかりません' })
  return { id: row.id }
})
