import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries } from '~~/server/db/schema'
import { assertAppDate } from '~~/server/utils/date'
import { itemsWorkedOn } from '~~/server/utils/diaries'
import type { DiaryDetailDto } from '~~/shared/types/diary'

/**
 * 指定した日の日記。
 *
 * まだ書かれていない日でも 404 にせず、空の状態で返す。
 * 「日付を開いたら、そのまま書き始められる」ようにするため
 * （docs/03-functional-spec.md 3.3）。
 */
export default defineEventHandler(async (event): Promise<DiaryDetailDto> => {
  const date = assertAppDate(getRouterParam(event, 'date'))
  const db = useDb()

  const [found] = await db.select().from(diaries).where(eq(diaries.date, date))
  const items = await itemsWorkedOn(db, date)

  return {
    date,
    body: found?.body ?? '',
    exists: Boolean(found),
    items,
  }
})
