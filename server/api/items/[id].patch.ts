import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items } from '~~/server/db/schema'
import { toUpdateValues } from '~~/server/utils/item-patch'
import { assertUuid, toItemDtos } from '~~/server/utils/items'
import { createNextOccurrence } from '~~/server/utils/recurrence'
import type { ItemDto } from '~~/shared/types/item'

interface Body {
  /**
   * 送る側が見ていたサーバーの updatedAt。
   *
   * これが今の値と違えば、間に他の端末（またはこの端末の別の経路）からの
   * 変更が入っている。黙って上書きせず 409 で今の内容を返す
   * （docs/12-offline.md 12.5）。省略されていれば確認しない。
   */
  baseUpdatedAt?: unknown
}

/** Item を更新する。指定された項目だけを変更する。 */
export default defineEventHandler(async (event): Promise<ItemDto> => {
  const id = assertUuid(getRouterParam(event, 'id'))
  const payload = await readBody<Body>(event)
  const values = toUpdateValues(payload)
  const baseUpdatedAt =
    typeof payload?.baseUpdatedAt === 'string' ? payload.baseUpdatedAt : null

  const db = useDb()

  const updated = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(items).where(eq(items.id, id))
    if (!before) {
      throw createError({ statusCode: 404, message: '見つかりません' })
    }

    if (baseUpdatedAt && before.updatedAt.toISOString() !== baseUpdatedAt) {
      const [current] = await toItemDtos(tx, [before])
      throw createError({
        statusCode: 409,
        message: '他の端末で変更されています',
        // クライアントはこれをそのまま採用する（サーバー優先）
        data: { item: current },
      })
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
