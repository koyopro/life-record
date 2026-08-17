import { desc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import { toAppDate } from '~~/server/utils/date'
import { assertUuid, toSectionDto } from '~~/server/utils/items'
import type { SectionDto } from '~~/shared/types/item'
import { BODY_MAX_LENGTH } from '~~/shared/utils/text'

interface Body {
  itemId?: unknown
  /** 作業・記録の日付。省略時は当日。 */
  date?: unknown
  body?: unknown
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

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

  let date = toAppDate()
  if (payload?.date !== undefined) {
    if (typeof payload.date !== 'string' || !DATE_PATTERN.test(payload.date)) {
      throw createError({ statusCode: 400, message: '不正な日付です' })
    }
    date = payload.date
  }

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

    // 同じ Item の末尾に置く
    const [last] = await tx
      .select({ position: sections.position })
      .from(sections)
      .where(eq(sections.itemId, itemId))
      .orderBy(desc(sections.position))
      .limit(1)

    const [created] = await tx
      .insert(sections)
      .values({
        itemId,
        date,
        body,
        position: (last?.position ?? -1) + 1,
      })
      .returning()

    if (!created) {
      throw createError({ statusCode: 500, message: '作成に失敗しました' })
    }

    return toSectionDto(created)
  })
})
