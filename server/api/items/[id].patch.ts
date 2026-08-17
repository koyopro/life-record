import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items } from '~~/server/db/schema'
import { toUpdateValues } from '~~/server/utils/item-patch'
import { assertUuid, toItemDtos } from '~~/server/utils/items'
import { createNextOccurrence } from '~~/server/utils/recurrence'
import type { ItemDto } from '~~/shared/types/item'

/** Item を更新する。指定された項目だけを変更する。 */
export default defineEventHandler(async (event): Promise<ItemDto> => {
  const id = assertUuid(getRouterParam(event, 'id'))
  const values = toUpdateValues(await readBody(event))

  const db = useDb()

  const updated = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(items).where(eq(items.id, id))
    if (!before) {
      throw createError({ statusCode: 404, message: '見つかりません' })
    }

    const [after] = await tx
      .update(items)
      .set(values)
      .where(eq(items.id, id))
      .returning()

    if (!after) {
      throw createError({ statusCode: 404, message: '見つかりません' })
    }

    // 繰り返し中のタスクを完了にしたら、次回分を作る
    // （docs/10-recurrence.md 10.2）。完了への遷移時だけ動かす。
    const justCompleted = before.status !== 'closed' && after.status === 'closed'
    if (justCompleted) {
      await createNextOccurrence(tx, after, values.updatedAt)
    }

    return after
  })

  const [dto] = await toItemDtos(db, [updated])
  return dto!
})
