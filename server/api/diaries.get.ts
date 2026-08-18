import { desc } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries } from '~~/server/db/schema'
import { excerptOf, itemCountsByDate } from '~~/server/utils/diaries'
import type { DiarySummaryDto } from '~~/shared/types/diary'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 200

/** 日記の一覧。日付の新しい順（docs/03-functional-spec.md 3.3）。 */
export default defineEventHandler(async (event): Promise<DiarySummaryDto[]> => {
  const query = getQuery(event)

  const requested = Number(query.limit)
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, MAX_LIMIT)
      : DEFAULT_LIMIT

  const db = useDb()

  const rows = await db
    .select()
    .from(diaries)
    .orderBy(desc(diaries.date))
    .limit(limit)

  const counts = await itemCountsByDate(
    db,
    rows.map((row) => row.date),
  )

  return rows.map((row) => ({
    date: row.date,
    excerpt: excerptOf(row.body),
    itemCount: counts.get(row.date) ?? 0,
  }))
})
