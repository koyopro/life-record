import { and, desc, gte, lte } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries } from '~~/server/db/schema'
import { excerptOf } from '~~/server/utils/diaries'
import type { DiarySummaryDto } from '~~/shared/types/diary'
import { isAppDate } from '~~/shared/utils/date'
import { firstImageSrc } from '~~/shared/utils/scrapbox/parse'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 200

/**
 * 日記の一覧。日付の新しい順（docs/03-functional-spec.md 3.3）。
 *
 * `from` / `to`（YYYY-MM-DD、両端を含む）で期間を絞れる。一覧は
 * カレンダー表示で、表示中の月に何があるかを知りたいため。件数で
 * 絞ると、古い月を開いたときにその月のぶんが返らない。
 */
export default defineEventHandler(async (event): Promise<DiarySummaryDto[]> => {
  const query = getQuery(event)

  const from = isAppDate(query.from) ? query.from : null
  const to = isAppDate(query.to) ? query.to : null

  const requested = Number(query.limit)
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, MAX_LIMIT)
      // 期間を指定しているなら、その期間ぶんは欠けずに返す
      : from || to
        ? MAX_LIMIT
        : DEFAULT_LIMIT

  const db = useDb()

  const rows = await db
    .select()
    .from(diaries)
    .where(
      and(
        from ? gte(diaries.date, from) : undefined,
        to ? lte(diaries.date, to) : undefined,
      ),
    )
    .orderBy(desc(diaries.date))
    .limit(limit)

  return rows.map((row) => ({
    date: row.date,
    excerpt: excerptOf(row.body),
    imageSrc: firstImageSrc(row.body),
  }))
})
