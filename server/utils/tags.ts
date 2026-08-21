import { and, asc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm'
import type { Executor } from '~~/server/db'
import { items, itemTags, tags } from '~~/server/db/schema'
import { normalizeTagName } from '~~/shared/types/tag'

/** 各 Item に付いているタグ名を、まとめて引く。 */
export async function tagsByItemId(
  db: Executor,
  itemIds: string[],
): Promise<Map<string, string[]>> {
  if (itemIds.length === 0) return new Map()

  const rows = await db
    .select({ itemId: itemTags.itemId, name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(inArray(itemTags.itemId, itemIds))
    .orderBy(asc(tags.name))

  const byItemId = new Map<string, string[]>()
  for (const row of rows) {
    const existing = byItemId.get(row.itemId)
    if (existing) existing.push(row.name)
    else byItemId.set(row.itemId, [row.name])
  }
  return byItemId
}

/**
 * タグ名から Tag を得る。存在しなければ作る。
 *
 * 同じ名前で同時に作ろうとした場合は一意制約に任せ、
 * 競合したら既存のほうを使う。
 */
export async function ensureTags(
  db: Executor,
  names: string[],
): Promise<Map<string, string>> {
  const normalized = [...new Set(names.map(normalizeTagName).filter(Boolean))] as string[]
  if (normalized.length === 0) return new Map()

  await db
    .insert(tags)
    .values(normalized.map((name) => ({ name })))
    .onConflictDoNothing({ target: tags.name })

  const rows = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(inArray(tags.name, normalized))

  return new Map(rows.map((row) => [row.name, row.id]))
}

/**
 * どの Item からも参照されなくなったタグを削除する。
 *
 * 使っていないタグが候補一覧に残り続けると、選択のノイズになる
 * （docs/09-tags.md 9.2）。
 */
export async function pruneOrphanTags(db: Executor): Promise<void> {
  const used = db.select({ tagId: itemTags.tagId }).from(itemTags)
  await db.delete(tags).where(notInArray(tags.id, used))
}

/**
 * タグ一覧を、Item 件数つきで取得する。
 *
 * 数えるのは**未完了のものだけ**（docs/09-tags.md 9.3）。タグを押した先の
 * 一覧は完了済みを除いて出しているので、完了済みまで数えると
 * 「5件」と出ているタグを開いて1件しか無い、ということが起きる。
 *
 * 完了済みしか無くなったタグも、0件として一覧には残す。名前と色は
 * 残っており、完了側（`h`）を見るときには使うため。
 */
export async function listTagsWithCount(db: Executor) {
  return await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      count: sql<number>`count(${items.id})::int`,
    })
    .from(tags)
    .leftJoin(itemTags, eq(itemTags.tagId, tags.id))
    // 結合の条件で絞る。where で絞ると、未完了が0件のタグごと消える
    .leftJoin(items, and(eq(items.id, itemTags.itemId), isOpen()))
    .groupBy(tags.id, tags.name, tags.color)
    .orderBy(asc(tags.name))
}

/** 1つのタグに付いている未完了 Item の件数。リネーム（統合）の応答に使う。 */
export async function countOpenItems(db: Executor, tagId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(itemTags)
    .innerJoin(items, eq(items.id, itemTags.itemId))
    .where(and(eq(itemTags.tagId, tagId), isOpen()))

  return row?.count ?? 0
}

/** 未完了（完了にしていない）Item の条件。数え方を1か所に集める。 */
function isOpen() {
  return ne(items.status, 'closed')
}
