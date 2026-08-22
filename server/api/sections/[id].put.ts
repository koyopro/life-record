import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import { assertAppDate } from '~~/server/utils/date'
import { assertUuid, nextPosition, toSectionDto } from '~~/server/utils/items'
import type { SectionDto } from '~~/shared/types/item'
import { BODY_MAX_LENGTH } from '~~/shared/utils/text'

interface Body {
  itemId?: unknown
  /** 作業・記録の日付。 */
  date?: unknown
  body?: unknown
}

/**
 * Section を upsert する（id はクライアントが決める）。
 *
 * オフラインで書いた記録にも、その場で id が要る（docs/12-offline.md 12.6）。
 * 作成と更新を分けず「その id の記録を、この内容にする」1つの操作にすることで、
 * 同じ操作が二度届いても結果が変わらない（冪等）。
 *
 * 日付が変われば並び順のグループも変わるので、移した先の末尾へ置き直す
 * （PATCH と同じ規則。docs/02-data-model.md 2.4）。
 */
export default defineEventHandler(async (event): Promise<SectionDto> => {
  const id = assertUuid(getRouterParam(event, 'id'), 'Section ID')
  const payload = await readBody<Body>(event)

  const itemId = assertUuid(payload?.itemId, 'Item ID')
  const date = assertAppDate(payload?.date)

  if (typeof payload?.body !== 'string') {
    throw createError({ statusCode: 400, message: '不正な本文です' })
  }
  if (payload.body.length > BODY_MAX_LENGTH) {
    throw createError({
      statusCode: 400,
      message: `本文は ${BODY_MAX_LENGTH} 文字までです`,
    })
  }

  const body = payload.body
  const db = useDb()

  return await db.transaction(async (tx) => {
    const [current] = await tx.select().from(sections).where(eq(sections.id, id))

    if (current && current.itemId !== itemId) {
      throw createError({
        statusCode: 400,
        message: '別のタスクの記録です',
      })
    }

    // 宛先の Item が無ければ作らない（クライアントは 404 を成功と同じに扱い、
    // その記録を手元からも消す）。Item ごと消えているのに記録だけ蘇らせない
    if (!current) {
      const [item] = await tx
        .select({ id: items.id })
        .from(items)
        .where(eq(items.id, itemId))
      if (!item) {
        throw createError({ statusCode: 404, message: 'Item が見つかりません' })
      }
    }

    const now = new Date()

    if (!current) {
      const [created] = await tx
        .insert(sections)
        .values({
          id,
          itemId,
          date,
          body,
          position: await nextPosition(tx, itemId, date),
        })
        .returning()

      if (!created) {
        throw createError({ statusCode: 500, message: '作成に失敗しました' })
      }
      return toSectionDto(created)
    }

    const position =
      current.date === date ? current.position : await nextPosition(tx, itemId, date)

    const [updated] = await tx
      .update(sections)
      .set({ date, body, position, updatedAt: now })
      .where(eq(sections.id, id))
      .returning()

    if (!updated) {
      throw createError({ statusCode: 404, message: '見つかりません' })
    }
    return toSectionDto(updated)
  })
})
