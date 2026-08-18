import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import { assertAppDate } from '~~/server/utils/date'
import { toAppDate } from '~~/shared/utils/date'
import { assertUuid, nextPosition, toSectionDto } from '~~/server/utils/items'
import type { SectionDto } from '~~/shared/types/item'
import { BODY_MAX_LENGTH } from '~~/shared/utils/text'

interface Body {
  itemId?: unknown
  /** 作業・記録の日付。省略時は当日。 */
  date?: unknown
  body?: unknown
}

/** Section を作成する。Item に対する、その日の作業記録。 */
export default defineEventHandler(async (event): Promise<SectionDto> => {
  const payload = await readBody<Body>(event)

  const itemId = assertUuid(payload?.itemId, 'Item ID')

  const body = typeof payload?.body === 'string' ? payload.body : ''
  if (body.length > BODY_MAX_LENGTH) {
    throw createError({
      statusCode: 400,
      message: `本文は ${BODY_MAX_LENGTH} 文字までです`,
    })
  }

  const date =
    payload?.date === undefined ? toAppDate() : assertAppDate(payload.date)

  const db = useDb()

  return await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: items.id })
      .from(items)
      .where(eq(items.id, itemId))
    if (!item) {
      throw createError({
        statusCode: 404,
        message: 'Item が見つかりません',
      })
    }

    const [created] = await tx
      .insert(sections)
      .values({
        itemId,
        date,
        body,
        // 同じ日付の記録の末尾に置く（docs/02-data-model.md 2.4）
        position: await nextPosition(tx, itemId, date),
      })
      .returning()

    if (!created) {
      throw createError({ statusCode: 500, message: '作成に失敗しました' })
    }

    return toSectionDto(created)
  })
})
