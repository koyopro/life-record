import {
  and,
  eq,
  exists,
  isNotNull,
  lte,
  ne,
  notExists,
  type SQL,
} from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { itemTags, items, tags } from '~~/server/db/schema'
import { endOfAppDay } from '~~/shared/utils/date'
import { assertUuid, orderByFor, toItemDtos } from '~~/server/utils/items'
import {
  isItemStatus,
  isSortKey,
  type ItemDto,
  type SortKey,
} from '~~/shared/types/item'
import type { Fetched } from '~~/shared/types/fetched'
import { fetched } from '~~/server/utils/fetched'
import { normalizeTagName } from '~~/shared/types/tag'

/**
 * Item 一覧。status / タグで絞り込み、sort で並べ替える。
 *
 * 手元の控え（IndexedDB）と突き合わせるので、応答を作った時刻を添えて返す
 * （`fetched`。docs/15-client-state.md 14.2 の 4）。
 */
export default defineEventHandler(async (event): Promise<Fetched<ItemDto[]>> => {
  const query = getQuery(event)
  const conditions: SQL[] = []

  const status = query.status
  if (status !== undefined && status !== 'all') {
    if (!isItemStatus(status)) {
      throw createError({ statusCode: 400, message: '不正な status です' })
    }
    conditions.push(eq(items.status, status))
  }

  // 「今日」リスト: 期限が今日の終わりまでに来ているもの。
  // 期限なしは対象外（いつやるか決まっていないため）。
  if (query.dueUntil === 'today') {
    conditions.push(isNotNull(items.dueAt))
    conditions.push(lte(items.dueAt, endOfAppDay()))
  }

  // 未完了のみ。「今日やること」の一覧に完了済みが混じると邪魔になる。
  if (query.open === 'true') {
    conditions.push(ne(items.status, 'closed'))
  }

  const db = useDb()

  // 繰り返しの系列。過去のオカレンスを辿るのに使う。
  if (query.series !== undefined) {
    conditions.push(eq(items.seriesId, assertUuid(query.series, '系列ID')))
  }

  // タグ絞り込み。EXISTS で引くことで、JOIN による行の重複を避ける。
  if (query.tag !== undefined) {
    const name = normalizeTagName(String(query.tag))
    if (!name) {
      throw createError({ statusCode: 400, message: '不正なタグ名です' })
    }
    conditions.push(
      exists(
        db
          .select({ one: itemTags.itemId })
          .from(itemTags)
          .innerJoin(tags, eq(tags.id, itemTags.tagId))
          .where(and(eq(itemTags.itemId, items.id), eq(tags.name, name))),
      ),
    )
  }

  if (query.untagged === 'true') {
    conditions.push(
      notExists(
        db
          .select({ one: itemTags.itemId })
          .from(itemTags)
          .where(eq(itemTags.itemId, items.id)),
      ),
    )
  }

  const sort: SortKey = isSortKey(query.sort) ? query.sort : 'priorityDueDesc'

  return await fetched(async () => {
    const rows = await db
      .select()
      .from(items)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderByFor(sort))

    return await toItemDtos(db, rows)
  })
})
