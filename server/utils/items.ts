import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { items, sections, type Item, type Section } from '~~/server/db/schema'
import type { Executor } from '~~/server/db'
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
  // 降順でも期限なしは末尾に送る（既定の NULLS FIRST では先頭に固まる）
  const dueDesc = sql`${items.dueAt} DESC NULLS LAST`

  switch (sort) {
    case 'priorityDueDesc':
      // 期限切れが下、今日が上に来る
      return [priorityAsc, dueDesc, asc(items.createdAt)]
    case 'dueDesc':
      return [dueDesc, priorityAsc, asc(items.createdAt)]
    case 'due':
      return [dueAsc, priorityAsc, asc(items.createdAt)]
    case 'created':
      return [desc(items.createdAt)]
  }
}

/**
 * Item の「本文」として扱う Section を選ぶ基準（docs/03-functional-spec.md 3.2）。
 *
 * 最初に作られたものを本文とする。position で決めないのは、position が
 * 同一日付内での並び順であり（docs/02-data-model.md 2.4）、
 * 並べ替えた途端に本文が別の Section へ移ってしまうため。
 */
export function comparePrimarySection(
  a: { createdAt: Date; position: number; id: string },
  b: { createdAt: Date; position: number; id: string },
): number {
  const created = a.createdAt.getTime() - b.createdAt.getTime()
  if (created !== 0) return created
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}

/**
 * 詳細画面での Section の並び（docs/03-functional-spec.md 3.1）。
 * 日付の**古い**順、同じ日付の中は position 昇順。
 *
 * 当日の枠を一番下に置くため（docs/03-functional-spec.md 3.2）。
 * クライアント（app/utils/section-order.ts）と同じ規則にする。
 */
export function compareSectionsForDisplay(a: Section, b: Section): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.position !== b.position) return a.position - b.position
  return a.createdAt.getTime() - b.createdAt.getTime()
}

/**
 * 同じ Item・同じ日付の記録の末尾に置くための position。
 *
 * position は日付をまたいだ通し番号ではなく、同一日付内での並び順
 * （docs/02-data-model.md 2.4）。
 */
export async function nextPosition(
  db: Executor,
  itemId: string,
  date: string,
): Promise<number> {
  const [last] = await db
    .select({ position: sections.position })
    .from(sections)
    .where(and(eq(sections.itemId, itemId), eq(sections.date, date)))
    .orderBy(desc(sections.position))
    .limit(1)

  return (last?.position ?? -1) + 1
}

/**
 * 各 Item の本文（最初の Section）を引く。一覧カードの表示に使う。
 *
 * Item ごとに1クエリ投げると件数分の往復が発生するので、まとめて取る。
 */
export async function firstSectionBodies(
  db: Executor,
  itemIds: string[],
): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map()

  const rows = await db
    .select({
      id: sections.id,
      itemId: sections.itemId,
      body: sections.body,
      position: sections.position,
      createdAt: sections.createdAt,
    })
    .from(sections)
    .where(inArray(sections.itemId, itemIds))
    .orderBy(asc(sections.createdAt), asc(sections.position), asc(sections.id))

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
    url: item.url,
    dueAt: item.dueAt?.toISOString() ?? null,
    dueHasTime: item.dueHasTime,
    body,
    tags,
    recurrenceRule: item.recurrenceRule,
    recurrenceBasis: item.recurrenceBasis,
    seriesId: item.seriesId,
    completedAt: item.completedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

/**
 * Item 群を DTO へ変換する。本文とタグをまとめて引いてから組み立てる。
 * 件数分の往復を避けるため、一覧系はすべてこれを通す。
 */
export async function toItemDtos(db: Executor, rows: Item[]): Promise<ItemDto[]> {
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
