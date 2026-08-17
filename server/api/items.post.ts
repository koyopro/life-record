import { useDb } from '~~/server/db'
import { itemTags, items, sections } from '~~/server/db/schema'
import { toAppDate } from '~~/server/utils/date'
import { toItemDto } from '~~/server/utils/items'
import { ensureTags } from '~~/server/utils/tags'
import { isItemStatus, type ItemDto, type ItemStatus } from '~~/shared/types/item'
import { parseSmartAdd } from '~~/shared/utils/smart-add'
import {
  BODY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  splitInput,
} from '~~/shared/utils/text'

interface Body {
  /** 生の入力テキスト。1行目に SmartAdd の記法を書ける。 */
  text?: string
  /** 初期 status。省略時は inbox。 */
  status?: ItemStatus
}

/**
 * Item を作成する。
 *
 * 1行目を SmartAdd として解釈し、2行目以降があれば作成日の Section を
 * 同時に作る（docs/07-open-questions.md Q7、docs/08-todo-management.md 8.4）。
 */
export default defineEventHandler(async (event): Promise<ItemDto> => {
  const payload = await readBody<Body>(event)

  const split = payload?.text ? splitInput(payload.text) : null
  if (!split) {
    throw createError({ statusCode: 400, message: '内容が空です' })
  }

  const parsed = parseSmartAdd(split.titleLine)
  if (!parsed.title) {
    throw createError({
      statusCode: 400,
      message: 'タイトルが空です',
    })
  }
  if (parsed.title.length > TITLE_MAX_LENGTH) {
    throw createError({
      statusCode: 400,
      message: `タイトルは ${TITLE_MAX_LENGTH} 文字までです`,
    })
  }
  if (split.body && split.body.length > BODY_MAX_LENGTH) {
    throw createError({
      statusCode: 400,
      message: `本文は ${BODY_MAX_LENGTH} 文字までです`,
    })
  }

  const status =
    payload?.status !== undefined && isItemStatus(payload.status)
      ? payload.status
      : 'inbox'

  const db = useDb()

  return await db.transaction(async (tx) => {
    const [item] = await tx
      .insert(items)
      .values({
        title: parsed.title,
        status,
        priority: parsed.priority,
        dueAt: parsed.dueAt,
        dueHasTime: parsed.dueHasTime,
        recurrenceRule: parsed.recurrence?.rule ?? null,
        recurrenceBasis: parsed.recurrence?.basis ?? null,
      })
      .returning()

    if (!item) {
      throw createError({
        statusCode: 500,
        message: '作成に失敗しました',
      })
    }

    if (split.body) {
      await tx.insert(sections).values({
        itemId: item.id,
        date: toAppDate(item.createdAt),
        body: split.body,
        position: 0,
      })
    }

    if (parsed.tags.length > 0) {
      const tagIds = await ensureTags(tx, parsed.tags)
      await tx.insert(itemTags).values(
        [...tagIds.values()].map((tagId) => ({ itemId: item.id, tagId })),
      )
    }

    return toItemDto(item, split.body ?? null, [...parsed.tags].sort())
  })
})
