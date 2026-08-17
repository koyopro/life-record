import { asc, desc, eq, inArray } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { items, sections } from '~~/server/db/schema'
import type { ItemStatus, Memo } from '~~/shared/types/memo'

const VALID_STATUSES: ItemStatus[] = [
  'inbox',
  'backlog',
  'in_progress',
  'closed',
]

/**
 * メモ（Item + 作成日の Section）の一覧を返す。
 * Milestone 2 では Inbox の新しい順のみを使う。
 */
export default defineEventHandler(async (event): Promise<Memo[]> => {
  const query = getQuery(event)
  const status = (query.status as string | undefined) ?? 'inbox'

  if (!VALID_STATUSES.includes(status as ItemStatus)) {
    throw createError({
      statusCode: 400,
      statusMessage: `status には ${VALID_STATUSES.join(' / ')} のいずれかを指定してください`,
    })
  }

  const db = useDb()

  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      status: items.status,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .where(eq(items.status, status as ItemStatus))
    .orderBy(desc(items.createdAt))

  if (rows.length === 0) return []

  // 各 Item の先頭 Section を本文として引く。
  // Milestone 2 では 1 Item につき最大 1 Section しか作らない。
  const bodies = await db
    .select({
      itemId: sections.itemId,
      body: sections.body,
      position: sections.position,
      createdAt: sections.createdAt,
    })
    .from(sections)
    .where(
      inArray(
        sections.itemId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(sections.position), asc(sections.createdAt))

  const bodyByItemId = new Map<string, string>()
  for (const section of bodies) {
    if (!bodyByItemId.has(section.itemId)) {
      bodyByItemId.set(section.itemId, section.body)
    }
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: bodyByItemId.get(row.id) ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))
})
