import { eq } from 'drizzle-orm'
import { useDb, type Executor } from '~~/server/db'
import { sections } from '~~/server/db/schema'
import { assertAppDate } from '~~/server/utils/date'
import { assertUuid, nextPosition, toSectionDto } from '~~/server/utils/items'
import type { SectionDto } from '~~/shared/types/item'
import { BODY_MAX_LENGTH } from '~~/shared/utils/text'

interface Body {
  body?: unknown
  /** 作業・記録の日付。書き間違えた日付を直せるようにする。 */
  date?: unknown
}

/**
 * Section を更新する。
 *
 * 本文編集は入力のたびに呼ばれる（リアルタイム保存）ため、
 * 本文だけの更新には余計な処理を挟まず単純な UPDATE に留める。
 */
export default defineEventHandler(async (event): Promise<SectionDto> => {
  const id = assertUuid(getRouterParam(event, 'id'), 'Section ID')
  const payload = await readBody<Body>(event)

  const values: { body?: string; date?: string } = {}

  if (payload?.body !== undefined) {
    if (typeof payload.body !== 'string') {
      throw createError({ statusCode: 400, message: '不正な本文です' })
    }
    if (payload.body.length > BODY_MAX_LENGTH) {
      throw createError({
        statusCode: 400,
        message: `本文は ${BODY_MAX_LENGTH} 文字までです`,
      })
    }
    values.body = payload.body
  }

  if (payload?.date !== undefined) values.date = assertAppDate(payload.date)

  if (values.body === undefined && values.date === undefined) {
    throw createError({ statusCode: 400, message: '変更する内容がありません' })
  }

  const db = useDb()

  // 本文だけなら日付の付け替えを考えなくてよいので、往復を増やさない
  if (values.date === undefined) {
    return toSectionDto(await update(db, id, values))
  }

  return await db.transaction(async (tx) => {
    const [current] = await tx.select().from(sections).where(eq(sections.id, id))
    if (!current) {
      throw createError({ statusCode: 404, message: '見つかりません' })
    }

    // 日付が変われば並び順のグループも変わる。移した先の末尾に置く
    // （position は同一日付内での並び順。docs/02-data-model.md 2.4）
    const position =
      current.date === values.date
        ? current.position
        : await nextPosition(tx, current.itemId, values.date!)

    return toSectionDto(await update(tx, id, { ...values, position }))
  })
})

async function update(
  db: Executor,
  id: string,
  values: { body?: string; date?: string; position?: number },
) {
  const [updated] = await db
    .update(sections)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(sections.id, id))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, message: '見つかりません' })
  }
  return updated
}
