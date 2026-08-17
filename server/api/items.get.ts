import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items } from '~~/server/db/schema'
import {
  firstSectionBodies,
  orderByFor,
  toItemDto,
} from '~~/server/utils/items'
import {
  isItemStatus,
  isSortKey,
  type ItemDto,
  type SortKey,
} from '~~/shared/types/item'

/** Item 一覧。status で絞り込み、sort で並べ替える。 */
export default defineEventHandler(async (event): Promise<ItemDto[]> => {
  const query = getQuery(event)

  const status = query.status
  if (status !== undefined && status !== 'all' && !isItemStatus(status)) {
    throw createError({
      statusCode: 400,
      statusMessage: '不正な status です',
    })
  }

  const sort: SortKey = isSortKey(query.sort) ? query.sort : 'priority'

  const db = useDb()

  const rows = await db
    .select()
    .from(items)
    .where(status && status !== 'all' ? eq(items.status, status) : undefined)
    .orderBy(...orderByFor(sort))

  const bodies = await firstSectionBodies(
    db,
    rows.map((row) => row.id),
  )

  return rows.map((row) => toItemDto(row, bodies.get(row.id) ?? null))
})
