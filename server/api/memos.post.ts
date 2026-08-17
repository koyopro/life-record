import { useDb } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import { toAppDate } from '~~/server/utils/date'
import {
  MEMO_BODY_MAX_LENGTH,
  MEMO_TITLE_MAX_LENGTH,
  splitMemoInput,
  type Memo,
} from '~~/shared/types/memo'

interface Body {
  /** 生の入力テキスト。1行目がタイトル、2行目以降が本文。 */
  text?: string
  /** 分割済みで送る場合。text が優先される。 */
  title?: string
  body?: string
}

/**
 * クイックメモを作成する。
 *
 * Item は本文を持たないため、本文がある場合は作成日の Section を
 * 同時に作る（docs/07-open-questions.md Q7）。
 */
export default defineEventHandler(async (event): Promise<Memo> => {
  const payload = await readBody<Body>(event)

  const input = payload?.text
    ? splitMemoInput(payload.text)
    : payload?.title
      ? splitMemoInput([payload.title, payload.body].filter(Boolean).join('\n'))
      : null

  if (!input) {
    throw createError({
      statusCode: 400,
      statusMessage: 'メモの内容が空です',
    })
  }

  if (input.title.length > MEMO_TITLE_MAX_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `タイトルは ${MEMO_TITLE_MAX_LENGTH} 文字までです`,
    })
  }

  if (input.body && input.body.length > MEMO_BODY_MAX_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `本文は ${MEMO_BODY_MAX_LENGTH} 文字までです`,
    })
  }

  const db = useDb()

  return await db.transaction(async (tx) => {
    const [item] = await tx
      .insert(items)
      .values({ title: input.title, status: 'inbox' })
      .returning()

    if (!item) {
      throw createError({
        statusCode: 500,
        statusMessage: 'メモの作成に失敗しました',
      })
    }

    if (input.body) {
      await tx.insert(sections).values({
        itemId: item.id,
        date: toAppDate(item.createdAt),
        body: input.body,
        position: 0,
      })
    }

    return {
      id: item.id,
      title: item.title,
      body: input.body ?? null,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }
  })
})
