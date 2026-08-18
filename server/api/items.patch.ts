import { inArray } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items } from '~~/server/db/schema'
import { toUpdateValues } from '~~/server/utils/item-patch'
import { assertUuid, toItemDtos } from '~~/server/utils/items'
import { createNextOccurrence } from '~~/server/utils/recurrence'
import type { ItemDto } from '~~/shared/types/item'

/** 複数選択（`x`）した Item への一括操作（docs/08-todo-management.md 8.4）。 */
const MAX_BULK_SIZE = 500

interface Body {
  ids?: unknown
  patch?: unknown
}

export default defineEventHandler(async (event): Promise<ItemDto[]> => {
  const payload = await readBody<Body>(event)

  if (!Array.isArray(payload?.ids) || payload.ids.length === 0) {
    throw createError({
      statusCode: 400,
      message: '対象が指定されていません',
    })
  }
  if (payload.ids.length > MAX_BULK_SIZE) {
    throw createError({
      statusCode: 400,
      message: `一度に変更できるのは ${MAX_BULK_SIZE} 件までです`,
    })
  }

  const ids = payload.ids.map((id) => assertUuid(id))
  const values = toUpdateValues(payload.patch)

  const db = useDb()
  const updated = await db.transaction(async (tx) => {
    const before = await tx.select().from(items).where(inArray(items.id, ids))
    const wasOpen = new Set(
      before.filter((row) => row.status !== 'closed').map((row) => row.id),
    )

    /*
     * 完了にした日時（completed_at）は status の遷移から決める。
     * 単一の values で一括更新すると全行へ同じ値が入ってしまうため、
     * 遷移の向きごとに分けて更新する（docs/02-data-model.md 2.3）。
     *
     * - open → closed：今の時刻を入れる
     * - closed → それ以外：null に戻す（再オープン）
     * - 遷移しない（closed のまま／open のまま）：触らない
     */
    const closingIds = new Set(
      values.status === 'closed' ? ids.filter((id) => wasOpen.has(id)) : [],
    )
    const reopeningIds = new Set(
      values.status !== undefined && values.status !== 'closed'
        ? ids.filter((id) => !wasOpen.has(id))
        : [],
    )
    const restIds = ids.filter(
      (id) => !closingIds.has(id) && !reopeningIds.has(id),
    )

    const after: (typeof before)[number][] = []
    if (closingIds.size > 0) {
      after.push(
        ...(await tx
          .update(items)
          .set({ ...values, completedAt: values.updatedAt })
          .where(inArray(items.id, [...closingIds]))
          .returning()),
      )
    }
    if (reopeningIds.size > 0) {
      after.push(
        ...(await tx
          .update(items)
          .set({ ...values, completedAt: null })
          .where(inArray(items.id, [...reopeningIds]))
          .returning()),
      )
    }
    if (restIds.length > 0) {
      after.push(
        ...(await tx
          .update(items)
          .set(values)
          .where(inArray(items.id, restIds))
          .returning()),
      )
    }

    // 一括完了でも、繰り返し中のものは次回分を作る。
    // 単体更新と挙動をそろえるため（docs/10-recurrence.md 10.2）。
    for (const row of after) {
      if (row.status === 'closed' && wasOpen.has(row.id)) {
        await createNextOccurrence(tx, row, values.updatedAt)
      }
    }

    return after
  })

  return await toItemDtos(db, updated)
})
