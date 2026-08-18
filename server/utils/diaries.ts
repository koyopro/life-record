import { desc, eq, inArray } from 'drizzle-orm'
import type { Executor } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import { toItemDtos } from '~~/server/utils/items'
import type { ItemDto } from '~~/shared/types/item'
import { DIARY_EXCERPT_LENGTH } from '~~/shared/types/diary'

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
 * 日付ごとの、その日に作業した Item の件数。
 *
 * 一覧では日数ぶん問い合わせると往復が増えるので、まとめて数える。
 */
export async function itemCountsByDate(
  db: Executor,
  dates: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (dates.length === 0) return counts

  const rows = await db
    .selectDistinct({ date: sections.date, itemId: sections.itemId })
    .from(sections)
    .where(inArray(sections.date, dates))

  for (const row of rows) {
    counts.set(row.date, (counts.get(row.date) ?? 0) + 1)
  }
  return counts
}

/**
 * 一覧に出す抜粋。
 *
 * 記法はそのまま残す。表示側で Scrapbox 記法として解釈するため、
 * ここで削ると本文と見た目が食い違う。
 */
export function excerptOf(body: string): string {
  const text = body.trim()
  if (text.length <= DIARY_EXCERPT_LENGTH) return text
  return `${text.slice(0, DIARY_EXCERPT_LENGTH)}…`
}
