import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { itemTags, items, sections } from '~~/server/db/schema'
import { toAppDate, todayDueAt } from '~~/shared/utils/date'
import { assertUuid, toItemDto, toItemDtos } from '~~/server/utils/items'
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
  /**
   * クライアントが決めた id。省略時は DB が採番する。
   *
   * 画面は応答を待たずに一覧へ出すため、その時点で id が要る。
   * 採番を任せると、返ってくるまで「まだ id のない Item」を抱えることになり、
   * 続けて行う編集の宛先が決まらない。
   */
  id?: string
}

/**
 * Item を作成する。
 *
 * 1行目を SmartAdd として解釈し、2行目以降があれば作成日の Section を
 * 同時に作る（docs/07-open-questions.md Q7、docs/08-todo-management.md 8.5）。
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
  const id = payload?.id !== undefined ? assertUuid(payload.id) : undefined

  return await db.transaction(async (tx) => {
    /*
     * 同じ id で二度届いたら、作らずに今あるものを返す（冪等）。
     *
     * オフライン中の操作を送るとき、「サーバーでは成功したが応答を
     * 受け取れなかった」場合に同じ内容を送り直す。ここで弾かないと
     * 二重登録になる（docs/12-offline.md 12.6）。
     */
    if (id) {
      const [existing] = await tx.select().from(items).where(eq(items.id, id))
      if (existing) {
        const [dto] = await toItemDtos(tx, [existing])
        return dto!
      }
    }

    const [item] = await tx
      .insert(items)
      .values({
        id,
        title: parsed.title,
        status,
        priority: parsed.priority,
        // 期限の指定がなければ今日にする。
        // 追加したタスクが「今日」リストに出ないまま埋もれるのを避ける。
        // ただし `^なし` / `^x` で明示的に外していれば、その指定に従う。
        dueAt: parsed.dueCleared ? null : (parsed.dueAt ?? todayDueAt()),
        dueHasTime: parsed.dueAt ? parsed.dueHasTime : false,
        url: parsed.url,
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
