import { and, desc, eq, exists, gte, lte, sql, type SQL } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries, itemTags, items, sections, tags } from '~~/server/db/schema'
import { assertAppDate } from '~~/server/utils/date'
import { excerptAround, likePattern } from '~~/server/utils/search'
import { toAppDate } from '~~/shared/utils/date'
import { isItemStatus, type ItemStatus } from '~~/shared/types/item'
import { isSearchKind, type SearchHit } from '~~/shared/types/search'
import { normalizeTagName } from '~~/shared/types/tag'

/** 種別ごとの取得上限。混ぜて並べ替えるので、それぞれ多めに取る。 */
const PER_KIND_LIMIT = 100
/** 返す件数の上限。 */
const TOTAL_LIMIT = 100

/**
 * Item.title / Section.body / Diary.body の横断検索
 * （docs/03-functional-spec.md 3.6）。
 *
 * 件数が小さいうちは `ILIKE` の部分一致で足りる。日本語では標準の
 * 全文検索が効きにくく、拡張（pg_bigm 等）が要るため、必要になってから
 * 入れる（docs/07-open-questions.md Q9）。
 */
export default defineEventHandler(async (event): Promise<SearchHit[]> => {
  const query = getQuery(event)

  const q = typeof query.q === 'string' ? query.q.trim() : ''
  if (!q) return []

  const kind = isSearchKind(query.kind) ? query.kind : 'all'
  const status: ItemStatus | null = isItemStatus(query.status)
    ? query.status
    : null
  const from = query.from ? assertAppDate(query.from, '開始日') : null
  const to = query.to ? assertAppDate(query.to, '終了日') : null

  let tagName: string | null = null
  if (query.tag !== undefined) {
    tagName = normalizeTagName(String(query.tag))
    if (!tagName) {
      throw createError({ statusCode: 400, message: '不正なタグ名です' })
    }
  }

  const pattern = likePattern(q)
  const db = useDb()
  const hits: SearchHit[] = []

  // タグでの絞り込み（docs/03-functional-spec.md 3.6、docs/09-tags.md）。
  // タグは Item に付くものなので、作業記録は「その記録が属する Item」の
  // タグで絞る。一覧側（items.get.ts）と同じく EXISTS で引き、
  // JOIN による行の重複を避ける。
  const tagged = tagName
    ? exists(
        db
          .select({ one: itemTags.itemId })
          .from(itemTags)
          .innerJoin(tags, eq(tags.id, itemTags.tagId))
          .where(and(eq(itemTags.itemId, items.id), eq(tags.name, tagName))),
      )
    : undefined

  // 期間は日付で受け取る。Item だけは日付列を持たないので、
  // 作成日時をその日の始まり・終わりと突き合わせる。
  const after = from ? new Date(`${from}T00:00:00.000+09:00`) : null
  const before = to ? new Date(`${to}T23:59:59.999+09:00`) : null

  function all(...conditions: (SQL | undefined)[]): SQL | undefined {
    const kept = conditions.filter((c): c is SQL => c !== undefined)
    return kept.length > 0 ? and(...kept) : undefined
  }

  if (kind === 'all' || kind === 'item') {
    const rows = await db
      .select()
      .from(items)
      .where(
        all(
          sql`${items.title} ILIKE ${pattern}`,
          status ? eq(items.status, status) : undefined,
          tagged,
          after ? gte(items.createdAt, after) : undefined,
          before ? lte(items.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(items.createdAt))
      .limit(PER_KIND_LIMIT)

    for (const row of rows) {
      hits.push({
        id: `item:${row.id}`,
        kind: 'item',
        date: toAppDate(row.createdAt),
        path: `/items/${row.id}`,
        title: row.title,
        excerpt: '',
        status: row.status,
      })
    }
  }

  if (kind === 'all' || kind === 'section') {
    const rows = await db
      .select({
        id: sections.id,
        date: sections.date,
        body: sections.body,
        itemId: items.id,
        title: items.title,
        status: items.status,
      })
      .from(sections)
      .innerJoin(items, eq(sections.itemId, items.id))
      .where(
        all(
          sql`${sections.body} ILIKE ${pattern}`,
          status ? eq(items.status, status) : undefined,
          tagged,
          from ? gte(sections.date, from) : undefined,
          to ? lte(sections.date, to) : undefined,
        ),
      )
      .orderBy(desc(sections.date))
      .limit(PER_KIND_LIMIT)

    for (const row of rows) {
      hits.push({
        id: `section:${row.id}`,
        kind: 'section',
        date: row.date,
        path: `/items/${row.itemId}`,
        title: row.title,
        excerpt: excerptAround(row.body, q),
        status: row.status,
      })
    }
  }

  // status は進行状態、タグは Item に付くものなので、どちらも日記には
  // 当てはまらない。絞り込みが指定されているときは、日記を混ぜない。
  // 絞り込みの対象外という理由で日記だけが素通りするのは分かりにくいため
  const excludesDiary = Boolean(status) || Boolean(tagName)
  if ((kind === 'all' && !excludesDiary) || kind === 'diary') {
    const rows = await db
      .select()
      .from(diaries)
      .where(
        all(
          sql`${diaries.body} ILIKE ${pattern}`,
          from ? gte(diaries.date, from) : undefined,
          to ? lte(diaries.date, to) : undefined,
        ),
      )
      .orderBy(desc(diaries.date))
      .limit(PER_KIND_LIMIT)

    for (const row of rows) {
      hits.push({
        id: `diary:${row.date}`,
        kind: 'diary',
        date: row.date,
        path: `/diary/${row.date}`,
        title: '日記',
        excerpt: excerptAround(row.body, q),
        status: null,
      })
    }
  }

  return hits
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
    .slice(0, TOTAL_LIMIT)
})
