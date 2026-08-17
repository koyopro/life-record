import { inArray } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items } from '~~/server/db/schema'
import { toUpdateValues } from '~~/server/utils/item-patch'
import {
  assertUuid,
  firstSectionBodies,
  toItemDto,
} from '~~/server/utils/items'
import type { ItemDto } from '~~/shared/types/item'

/** 複数選択（`x`）した Item への一括操作（docs/08-todo-management.md 8.3）。 */
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
      statusMessage: '対象が指定されていません',
    })
  }
  if (payload.ids.length > MAX_BULK_SIZE) {
    throw createError({
      statusCode: 400,
      statusMessage: `一度に変更できるのは ${MAX_BULK_SIZE} 件までです`,
    })
  }

  const ids = payload.ids.map((id) => assertUuid(id))
  const values = toUpdateValues(payload.patch)

  const db = useDb()
  const updated = await db
    .update(items)
    .set(values)
    .where(inArray(items.id, ids))
    .returning()

  const bodies = await firstSectionBodies(
    db,
    updated.map((row) => row.id),
  )

  return updated.map((row) => toItemDto(row, bodies.get(row.id) ?? null))
})
