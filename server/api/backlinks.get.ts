import { and, desc, eq, ne, sql, type SQL } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries, items, sections } from '~~/server/db/schema'
import { excerptAround, likePattern } from '~~/server/utils/search'
import { tagsByItemId } from '~~/server/utils/tags'
import { toAppDate } from '~~/shared/utils/date'
import type { Priority } from '~~/shared/types/item'
import { BACKLINK_LIMIT, isLinkablePath, type Backlink } from '~~/shared/types/backlink'

/**
 * そのページを指している本文を集める（docs/11-scrapbox-notation.md 11.11）。
 *
 * 相互リンクのための中間テーブルは持たない。本文に書いた
 * `[/diary/month/2026-09]` のようなリンクを、`Item.note` /
 * `Section.body` / `Diary.body` から探し出して逆向きに並べる。
 * 保存されるのは1方向だけなので、両側を揃える手間も食い違いもない。
 *
 * 探すのは検索（`/api/search`）と同じ `ILIKE` の部分一致。ここで受け付ける
 * パスは、いずれも後ろに何も続かない形（UUID・`YYYY-MM-DD`・
 * `month/YYYY-MM`）にそろえてあるので、部分一致でも別のページのリンクを
 * 巻き込まない。
 */
export default defineEventHandler(async (event): Promise<Backlink[]> => {
  const query = getQuery(event)

  const path = query.path
  if (!isLinkablePath(path)) {
    throw createError({ statusCode: 400, message: 'リンクできるパスではありません' })
  }

  const pattern = likePattern(path)
  const db = useDb()
  const found: Backlink[] = []

  /*
   * 完了したタスクも出す。検索（既定は未完了）と違い、こちらは
   * 「このページを指しているものが他にあるか」を漏れなく見たいため。
   * 月の振り返りのように、済んだタスクから指されているのが普通。
   */

  function all(...conditions: (SQL | undefined)[]): SQL | undefined {
    const kept = conditions.filter((c): c is SQL => c !== undefined)
    return kept.length > 0 ? and(...kept) : undefined
  }

  /** 行ごとの Item の id。タグはあとでまとめて引く（往復を減らす）。 */
  const itemIdOf = new Map<string, string>()

  /*
   * タスク自身のページを指しているタスクは、自分自身を除く。メモに
   * 自分へのリンクを書くことは普通ないが、書けてしまう以上は出さない。
   */
  const selfItemId = /^\/items\/(.+)$/.exec(path)?.[1] ?? null

  // Item.note（メモ）。タイトルにはリンクを書けないので見ない
  const itemRows = await db
    .select()
    .from(items)
    .where(
      all(
        sql`${items.note} ILIKE ${pattern}`,
        selfItemId ? ne(items.id, selfItemId) : undefined,
      ),
    )
    .orderBy(desc(items.createdAt))
    .limit(BACKLINK_LIMIT)

  for (const row of itemRows) {
    const id = `item:${row.id}`
    itemIdOf.set(id, row.id)
    found.push({
      id,
      kind: 'item',
      date: toAppDate(row.createdAt),
      path: `/items/${row.id}`,
      title: row.title,
      excerpt: excerptAround(row.note ?? '', path),
      item: {
        id: row.id,
        status: row.status,
        priority: (row.priority as Priority | null) ?? null,
        tags: [],
        dueAt: row.dueAt?.toISOString() ?? null,
        dueHasTime: row.dueHasTime,
      },
    })
  }

  // Section.body（作業記録）
  const sectionRows = await db
    .select({
      id: sections.id,
      date: sections.date,
      body: sections.body,
      itemId: items.id,
      title: items.title,
      status: items.status,
      priority: items.priority,
      dueAt: items.dueAt,
      dueHasTime: items.dueHasTime,
    })
    .from(sections)
    .innerJoin(items, eq(sections.itemId, items.id))
    .where(
      all(
        sql`${sections.body} ILIKE ${pattern}`,
        selfItemId ? ne(items.id, selfItemId) : undefined,
      ),
    )
    .orderBy(desc(sections.date))
    .limit(BACKLINK_LIMIT)

  for (const row of sectionRows) {
    const id = `section:${row.id}`
    itemIdOf.set(id, row.itemId)
    found.push({
      id,
      kind: 'section',
      date: row.date,
      path: `/items/${row.itemId}`,
      title: row.title,
      excerpt: excerptAround(row.body, path),
      item: {
        id: row.itemId,
        status: row.status,
        priority: (row.priority as Priority | null) ?? null,
        tags: [],
        dueAt: row.dueAt?.toISOString() ?? null,
        dueHasTime: row.dueHasTime,
      },
    })
  }

  // Diary.body（日記）
  const diaryRows = await db
    .select()
    .from(diaries)
    .where(sql`${diaries.body} ILIKE ${pattern}`)
    .orderBy(desc(diaries.date))
    .limit(BACKLINK_LIMIT)

  for (const row of diaryRows) {
    found.push({
      id: `diary:${row.date}`,
      kind: 'diary',
      date: row.date,
      path: `/diary/${row.date}`,
      title: '日記',
      excerpt: excerptAround(row.body, path),
      item: null,
    })
  }

  const sorted = found
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
    .slice(0, BACKLINK_LIMIT)

  // 返すぶんだけタグを引く。切り捨てた行のために引いても使い道がない
  const tagNames = await tagsByItemId(
    db,
    [
      ...new Set(
        sorted.map((link) => itemIdOf.get(link.id)).filter((id) => id !== undefined),
      ),
    ],
  )
  for (const link of sorted) {
    const itemId = itemIdOf.get(link.id)
    if (link.item && itemId) link.item.tags = tagNames.get(itemId) ?? []
  }

  return sorted
})
