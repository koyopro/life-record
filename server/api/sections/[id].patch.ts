import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { sections } from '~~/server/db/schema'
import { assertUuid, toSectionDto } from '~~/server/utils/items'
import type { SectionDto } from '~~/shared/types/item'
import { BODY_MAX_LENGTH } from '~~/shared/utils/text'

/**
 * Section の本文を更新する。
 *
 * 本文編集は入力のたびに呼ばれる（リアルタイム保存）ため、
 * 余計な処理を挟まず単純な UPDATE に留める。
 */
export default defineEventHandler(async (event): Promise<SectionDto> => {
  const id = assertUuid(getRouterParam(event, 'id'), 'Section ID')
  const payload = await readBody<{ body?: unknown }>(event)

  if (typeof payload?.body !== 'string') {
    throw createError({ statusCode: 400, statusMessage: '不正な本文です' })
  }
  if (payload.body.length > BODY_MAX_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `本文は ${BODY_MAX_LENGTH} 文字までです`,
    })
  }

  const db = useDb()
  const [updated] = await db
    .update(sections)
    .set({ body: payload.body, updatedAt: new Date() })
    .where(eq(sections.id, id))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: '見つかりません' })
  }

  return toSectionDto(updated)
})
