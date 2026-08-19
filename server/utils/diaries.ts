import { desc, eq, inArray } from 'drizzle-orm'
import type { Executor } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import { toItemDtos } from '~~/server/utils/items'
import type { ItemDto } from '~~/shared/types/item'
import { DIARY_EXCERPT_LENGTH } from '~~/shared/types/diary'
import { toPlainText } from '~~/shared/utils/scrapbox/render'

/**
 * その日に作業した Item を引く（docs/02-data-model.md 2.7）。
 *
 * Diary と Section は直接の関連を持たず、同じ日付であることだけで結び付く。
 */
export async function itemsWorkedOn(
  db: Executor,
  date: string,
): Promise<ItemDto[]> {
  const rows = await db
    .selectDistinct({ id: sections.itemId })
    .from(sections)
    .where(eq(sections.date, date))

  const ids = rows.map((row) => row.id)
  if (ids.length === 0) return []

  const found = await db
    .select()
    .from(items)
    .where(inArray(items.id, ids))
    .orderBy(desc(items.updatedAt))

  return await toItemDtos(db, found)
}

/**
 * 一覧に出す抜粋。
 *
 * カレンダーの枠内にそのまま表示するため、記法を除いたプレーンテキストにする。
 */
export function excerptOf(body: string): string {
  const text = toPlainText(body)
  if (text.length <= DIARY_EXCERPT_LENGTH) return text
  return `${text.slice(0, DIARY_EXCERPT_LENGTH)}…`
}
