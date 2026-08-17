import { asc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { Db } from '~~/server/db'
import { itemTags, tags } from '~~/server/db/schema'
import { normalizeTagName } from '~~/shared/types/tag'

/** Db もしくはトランザクションのどちらでも受けられるようにする。 */
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

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

/** タグ一覧を、Item 件数つきで取得する。 */
export async function listTagsWithCount(db: Executor) {
  return await db
    .select({
      id: tags.id,
      name: tags.name,
      count: sql<number>`count(${itemTags.itemId})::int`,
    })
    .from(tags)
    .leftJoin(itemTags, eq(itemTags.tagId, tags.id))
    .groupBy(tags.id, tags.name)
    .orderBy(asc(tags.name))
}
