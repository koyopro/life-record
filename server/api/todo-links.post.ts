import { eq, sql } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries, items, sections } from '~~/server/db/schema'
import { assertUuid } from '~~/server/utils/items'
import { likePattern } from '~~/server/utils/search'
import { linkTodoTitle } from '~~/shared/utils/todo-link'

interface Body {
  /** リンク先に決まった TODO。 */
  itemId?: unknown
  /** `[題]` の題。 */
  title?: unknown
}

/** 書き換えた件数。 */
export interface TodoLinkResult {
  diaries: number
  sections: number
  items: number
}

/**
 * 本文の `[題]` を、すべて `[/items/<id> 題]` に書き換える
 * （docs/11-scrapbox-notation.md 11.13「同じ題のリンクをまとめて決める」）。
 *
 * 押した1か所だけでなく、**他の日の日記・作業記録・メモに書いた同じ `[題]`**
 * も同じ TODO を指すものとして決める。とりあえず `[題]` で書いておき、
 * あとで TODO を作った時点で、それまでの分もまとめてリンク先が決まる。
 *
 * 宛先の TODO が（まだ）サーバーに無くても書き換える。リンクは本文の文字に
 * すぎず、TODO はオフラインで作ったものが後から届くことがある。
 *
 * 何度送っても結果は変わらない（2回目には書き換える `[題]` が残っていない）。
 */
export default defineEventHandler(async (event): Promise<TodoLinkResult> => {
  const payload = await readBody<Body>(event)
  const itemId = assertUuid(payload?.itemId, 'Item ID')

  if (typeof payload?.title !== 'string' || !payload.title.trim()) {
    throw createError({ statusCode: 400, message: '題がありません' })
  }
  const title = payload.title.trim()
  if (title.startsWith('/') || /[[\]\n]/.test(title)) {
    throw createError({ statusCode: 400, message: 'TODO の題ではありません' })
  }

  // 当たりそうな本文だけを引く。どこが `[題]` なのかは記法として読んで決める
  const pattern = likePattern(title)
  const db = useDb()
  const result: TodoLinkResult = { diaries: 0, sections: 0, items: 0 }

  await db.transaction(async (tx) => {
    const now = new Date()

    const diaryRows = await tx
      .select({ date: diaries.date, body: diaries.body })
      .from(diaries)
      .where(sql`${diaries.body} ILIKE ${pattern}`)
    for (const row of diaryRows) {
      const body = linkTodoTitle(row.body, title, itemId)
      if (body === row.body) continue
      await tx.update(diaries).set({ body, updatedAt: now }).where(eq(diaries.date, row.date))
      result.diaries += 1
    }

    const sectionRows = await tx
      .select({ id: sections.id, body: sections.body })
      .from(sections)
      .where(sql`${sections.body} ILIKE ${pattern}`)
    for (const row of sectionRows) {
      const body = linkTodoTitle(row.body, title, itemId)
      if (body === row.body) continue
      await tx.update(sections).set({ body, updatedAt: now }).where(eq(sections.id, row.id))
      result.sections += 1
    }

    /*
     * メモ（Item.note）は updatedAt を進めない。
     *
     * Item の更新は競合を確かめる（docs/12-offline.md 12.5）。ここで進めると、
     * その Item に未送信の変更を持っている端末の送信が 409 になり、中身の
     * 新旧比べでこちらが勝って**その変更が捨てられる**。リンクの書き換えは
     * 利用者がそのメモを書き換えたわけではないので、版としては数えない。
     * 手元の写しは、次に一覧を取り直したときに（同期済みなら）揃う。
     */
    const itemRows = await tx
      .select({ id: items.id, note: items.note })
      .from(items)
      .where(sql`${items.note} ILIKE ${pattern}`)
    for (const row of itemRows) {
      if (row.note === null) continue
      const note = linkTodoTitle(row.note, title, itemId)
      if (note === row.note) continue
      await tx.update(items).set({ note }).where(eq(items.id, row.id))
      result.items += 1
    }
  })

  return result
})
