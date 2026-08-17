import { asc, desc, inArray, sql, type SQL } from 'drizzle-orm'
import { items, sections, type Item, type Section } from '~~/server/db/schema'
import type { Db } from '~~/server/db'
import type {
  ItemDto,
  Priority,
  SectionDto,
  SortKey,
} from '~~/shared/types/item'

/**
 * ソート軸ごとの ORDER BY（docs/08-todo-management.md 8.2）。
 *
 * 重要度なし・期限なしは末尾に置く。最後に created_at を入れて
 * 同値時の順序を安定させる。
 */
export function orderByFor(sort: SortKey): SQL[] {
  const priorityAsc = sql`${items.priority} ASC NULLS LAST`
  const dueAsc = sql`${items.dueAt} ASC NULLS LAST`

  switch (sort) {
    case 'priority':
      return [priorityAsc, dueAsc, asc(items.createdAt)]
    case 'due':
      return [dueAsc, priorityAsc, asc(items.createdAt)]
    case 'created':
      return [desc(items.createdAt)]
    case 'title':
      return [asc(items.title), asc(items.createdAt)]
  }
}

/**
 * 各 Item の先頭 Section の本文を引く。一覧カードの表示に使う。
 *
 * Item ごとに1クエリ投げると件数分の往復が発生するので、まとめて取る。
 */
export async function firstSectionBodies(
  db: Db,
  itemIds: string[],
): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map()

  const rows = await db
    .select({
      itemId: sections.itemId,
      body: sections.body,
      position: sections.position,
      createdAt: sections.createdAt,
    })
    .from(sections)
    .where(inArray(sections.itemId, itemIds))
    .orderBy(asc(sections.position), asc(sections.createdAt))

  const byItemId = new Map<string, string>()
  for (const row of rows) {
    if (!byItemId.has(row.itemId)) byItemId.set(row.itemId, row.body)
  }
  return byItemId
}

export function toItemDto(
  item: Item,
  body: string | null = null,
  tags: string[] = [],
): ItemDto {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: (item.priority as Priority | null) ?? null,
    dueAt: item.dueAt?.toISOString() ?? null,
    dueHasTime: item.dueHasTime,
    body,
    tags,
    recurrenceRule: item.recurrenceRule,
    recurrenceBasis: item.recurrenceBasis,
    seriesId: item.seriesId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

/**
 * Item 群を DTO へ変換する。本文とタグをまとめて引いてから組み立てる。
 * 件数分の往復を避けるため、一覧系はすべてこれを通す。
 */
export async function toItemDtos(db: Db, rows: Item[]): Promise<ItemDto[]> {
  const ids = rows.map((row) => row.id)
  const [bodies, tagNames] = await Promise.all([
    firstSectionBodies(db, ids),
    tagsByItemId(db, ids),
  ])

  return rows.map((row) =>
    toItemDto(row, bodies.get(row.id) ?? null, tagNames.get(row.id) ?? []),
  )
}

export function toSectionDto(section: Section): SectionDto {
  return {
    id: section.id,
    date: section.date,
    body: section.body,
    position: section.position,
    createdAt: section.createdAt.toISOString(),
    updatedAt: section.updatedAt.toISOString(),
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function assertUuid(value: unknown, label = 'ID'): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw createError({
      statusCode: 400,
      message: `不正な${label}です`,
    })
  }
  return value
}
