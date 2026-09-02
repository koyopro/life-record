import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries } from '~~/server/db/schema'
import { assertAppDate } from '~~/server/utils/date'
import { itemsWorkedOn, sectionsOnDate } from '~~/server/utils/diaries'
import type { DiaryDetailDto } from '~~/shared/types/diary'
import type { Fetched } from '~~/shared/types/fetched'
import { fetched } from '~~/server/utils/fetched'

/**
 * 指定した日の日記。
 *
 * まだ書かれていない日でも 404 にせず、空の状態で返す。
 * 「日付を開いたら、そのまま書き始められる」ようにするため
 * （docs/03-functional-spec.md 3.3）。
 *
 * 手元の控え（IndexedDB）と突き合わせるので、応答を作った時刻を添えて返す
 * （`fetched`。docs/15-client-state.md 14.2 の 4）。
 */
export default defineEventHandler(
  async (event): Promise<Fetched<DiaryDetailDto>> => {
    const date = assertAppDate(getRouterParam(event, 'date'))
    const db = useDb()

    return await fetched(async () => {
      const [found] = await db.select().from(diaries).where(eq(diaries.date, date))
      const items = await itemsWorkedOn(db, date)
      const sections = await sectionsOnDate(db, date)

      return {
        date,
        body: found?.body ?? '',
        exists: Boolean(found),
        updatedAt: found?.updatedAt.toISOString() ?? null,
        items,
        sections,
      }
    })
  },
)
