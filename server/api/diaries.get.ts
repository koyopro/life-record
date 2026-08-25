import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { useDb, type Executor } from '~~/server/db'
import { diaries, items, sections } from '~~/server/db/schema'
import { excerptOf, pinnedImageOf } from '~~/shared/utils/diary'
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

  const pinnedImages = await pinnedImagesByDate(db, from, to)

  const summaries: DiarySummaryDto[] = rows.map((row) => ({
    date: row.date,
    excerpt: excerptOf(row.body),
    imageSrc: firstImageSrc(row.body),
    pinnedImageSrc: pinnedImages.get(row.date) ?? null,
  }))

  /*
   * 日記を書いていない日でも、ピン留めした作業記録に画像があればその日は
   * カレンダーに出す。ピン留めは「その日の目印」なので、本文を書いた日
   * だけに出しても目印にならない。
   */
  const written = new Set(summaries.map((summary) => summary.date))
  for (const [date, imageSrc] of pinnedImages) {
    if (written.has(date)) continue
    summaries.push({ date, excerpt: '', imageSrc: null, pinnedImageSrc: imageSrc })
  }

  return summaries.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit)
})

/**
 * 日付ごとの「ピン留めした作業記録の画像」。
 *
 * 並べる順は日記の画面と同じ（Item の更新が新しい順。
 * server/utils/diaries.ts の `itemsWorkedOn`）で、上に出ているものを優先する。
 */
async function pinnedImagesByDate(
  db: Executor,
  from: string | null,
  to: string | null,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ date: sections.date, body: sections.body })
    .from(sections)
    .innerJoin(items, eq(items.id, sections.itemId))
    .where(
      and(
        eq(sections.pinned, true),
        from ? gte(sections.date, from) : undefined,
        to ? lte(sections.date, to) : undefined,
      ),
    )
    .orderBy(desc(items.updatedAt))

  const bodies = new Map<string, string[]>()
  for (const row of rows) {
    const list = bodies.get(row.date) ?? []
    list.push(row.body)
    bodies.set(row.date, list)
  }

  const found = new Map<string, string>()
  for (const [date, list] of bodies) {
    const image = pinnedImageOf(list)
    if (image) found.set(date, image)
  }
  return found
}
