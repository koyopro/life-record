import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries } from '~~/server/db/schema'
import { assertAppDate } from '~~/server/utils/date'
import type { DiaryDto } from '~~/shared/types/diary'
import { BODY_MAX_LENGTH } from '~~/shared/utils/text'

/**
 * 日記を upsert する（`date` が主キーのため。docs/03-functional-spec.md 3.3）。
 *
 * 本文が空になったら行ごと消す。書きかけて消した日が一覧に
 * 空のまま並び続けないようにするため。
 */
export default defineEventHandler(async (event): Promise<DiaryDto> => {
  const date = assertAppDate(getRouterParam(event, 'date'))
  const payload = await readBody<{ body?: unknown }>(event)

  if (typeof payload?.body !== 'string') {
    throw createError({ statusCode: 400, message: '不正な本文です' })
  }
  if (payload.body.length > BODY_MAX_LENGTH) {
    throw createError({
      statusCode: 400,
      message: `本文は ${BODY_MAX_LENGTH} 文字までです`,
    })
  }

  const db = useDb()
  const body = payload.body

  if (!body.trim()) {
    await db.delete(diaries).where(eq(diaries.date, date))
    return { date, body: '' }
  }

  const now = new Date()
  const [saved] = await db
    .insert(diaries)
    .values({ date, body })
    .onConflictDoUpdate({
      target: diaries.date,
      set: { body, updatedAt: now },
    })
    .returning()

  if (!saved) {
    throw createError({ statusCode: 500, message: '保存に失敗しました' })
  }

  return { date: saved.date, body: saved.body }
})
