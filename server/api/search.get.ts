import { and, desc, eq, exists, gte, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries, itemTags, items, sections, tags } from '~~/server/db/schema'
import { assertAppDate } from '~~/server/utils/date'
import { excerptAround, likePattern } from '~~/server/utils/search'
import { tagsByItemId } from '~~/server/utils/tags'
import { toAppDate } from '~~/shared/utils/date'
import type { Priority } from '~~/shared/types/item'
import { isSearchKind, isSearchView, type SearchHit } from '~~/shared/types/search'
import { normalizeTagName } from '~~/shared/types/tag'

/** 種別ごとの取得上限。混ぜて並べ替えるので、それぞれ多めに取る。 */
const PER_KIND_LIMIT = 100
/** 返す件数の上限。 */
const TOTAL_LIMIT = 100

/**
 * Item.title・Item.note / Section.body / Diary.body の横断検索
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
  /*
   * タスクの表示方法（未完了 / 完了）。一覧と同じく既定は未完了で、
   * 「片付いていないもののうち、あれは何だったか」を探すのが普段の
   * 使い方だから（docs/03-functional-spec.md 3.6）。
   */
  const view = isSearchView(query.view) ? query.view : 'open'
  const openOnly =
    view === 'completed' ? eq(items.status, 'closed') : ne(items.status, 'closed')
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

  /*
   * 行ごとの Item の id。タグはあとでまとめて引くため（件数分の往復を
   * 避ける。一覧の toItemDtos と同じやり方）、ここで控えておく。
   */
  const itemIdOf = new Map<string, string>()

  if (kind === 'all' || kind === 'item') {
    const rows = await db
      .select()
      .from(items)
      .where(
        all(
          // メモも Item 自身の中身なので、タイトルと同じ扱いで拾う
          or(sql`${items.title} ILIKE ${pattern}`, sql`${items.note} ILIKE ${pattern}`),
          openOnly,
          tagged,
          after ? gte(items.createdAt, after) : undefined,
          before ? lte(items.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(items.createdAt))
      .limit(PER_KIND_LIMIT)

    for (const row of rows) {
      const id = `item:${row.id}`
      itemIdOf.set(id, row.id)
      hits.push({
        id,
        kind: 'item',
        date: toAppDate(row.createdAt),
        path: `/items/${row.id}`,
        title: row.title,
        // タイトルで当たったなら、そこは行の見出しにもう出ている。
        // メモで当たったときだけ、その周りを抜き出して見せる
        excerpt: row.note ? excerptAround(row.note, q) : '',
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
        priority: items.priority,
        dueAt: items.dueAt,
        dueHasTime: items.dueHasTime,
      })
      .from(sections)
      .innerJoin(items, eq(sections.itemId, items.id))
      .where(
        all(
          sql`${sections.body} ILIKE ${pattern}`,
          openOnly,
          tagged,
          from ? gte(sections.date, from) : undefined,
          to ? lte(sections.date, to) : undefined,
        ),
      )
      .orderBy(desc(sections.date))
      .limit(PER_KIND_LIMIT)

    for (const row of rows) {
      const id = `section:${row.id}`
      itemIdOf.set(id, row.itemId)
      hits.push({
        id,
        kind: 'section',
        date: row.date,
        path: `/items/${row.itemId}`,
        title: row.title,
        excerpt: excerptAround(row.body, q),
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
  }

  /*
   * タグは Item に付くものなので、日記には当てはまらない。タグで絞った
   * ときは日記を混ぜない。絞り込みの対象外という理由で、日記だけが
   * 素通りするのは分かりにくいため。
   *
   * 「未完了 / 完了」は同じ理由では外さない。こちらは常に効いている
   * 見方なので、外すと既定の検索から日記が丸ごと消えてしまう
   * （docs/03-functional-spec.md 3.6）。
   */
  const excludesDiary = Boolean(tagName)
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
        item: null,
      })
    }
  }

  const sorted = hits
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
    .slice(0, TOTAL_LIMIT)

  // 返すぶんだけタグを引く。切り捨てた行のために引いても使い道がない
  const tagNames = await tagsByItemId(
    db,
    [...new Set(sorted.map((hit) => itemIdOf.get(hit.id)).filter((id) => id !== undefined))],
  )
  for (const hit of sorted) {
    const itemId = itemIdOf.get(hit.id)
    if (hit.item && itemId) hit.item.tags = tagNames.get(itemId) ?? []
  }

  return sorted
})
