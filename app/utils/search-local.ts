import type { LocalDiary, LocalItem, LocalSection } from '~/utils/offline/local-database'
import type { SearchHit, SearchQuery } from '~~/shared/types/search'
import { excerptAround, sortSearchHits } from '~~/shared/utils/search'
import { toAppDate } from '~~/shared/utils/date'

/**
 * 手元（IndexedDB）だけで検索する（docs/03-functional-spec.md 3.6）。
 *
 * 検索は待たせない。サーバーへ聞きに行っている間、手元にあるぶんを先に出す
 * （docs/12-offline.md 12.4 の考え方をそのまま検索にも当てる）。応答が
 * 届いたら重ねる（`mergeSearchHits`）。
 *
 * **タスクは手元に全件ある**ので、タスク名・メモの検索はこれだけで足りる。
 * 作業記録と日記は開いたぶんしか無いので、こちらはサーバーの応答で増える。
 *
 * 当てる条件は `server/api/search.get.ts` と同じにする。ずれていると、
 * 応答が届いた瞬間に行が増えたり消えたりする。
 */
export interface LocalSearchSource {
  items: LocalItem[]
  sections: LocalSection[]
  diaries: LocalDiary[]
}

export function searchLocally(
  source: LocalSearchSource,
  query: SearchQuery,
): SearchHit[] {
  const needle = query.q.trim().toLowerCase()
  if (!needle) return []

  /** ILIKE の部分一致に当たるもの。`%` `_` は文字としてそのまま比べる。 */
  const hit = (text: string | null) =>
    typeof text === 'string' && text.toLowerCase().includes(needle)

  const inRange = (date: string) =>
    (!query.from || date >= query.from) && (!query.to || date <= query.to)

  const items = source.items.filter((item) => matchesConditions(item, query))
  const byId = new Map(items.map((item) => [item.id, item]))
  const hits: SearchHit[] = []

  if (query.kind === 'all' || query.kind === 'item') {
    const found = items
      .filter((item) => hit(item.title) || hit(item.note))
      .filter((item) => inRange(toAppDate(new Date(item.createdAt))))
      // サーバーと同じく作成の新しい順（同じ日付の中での並びがそろう）。
      // 同着で 0 を返さないと、並べ替えが安定せず順序が入れ替わる
      .sort((a, b) =>
        a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
      )

    for (const item of found) {
      hits.push({
        id: `item:${item.id}`,
        kind: 'item',
        date: toAppDate(new Date(item.createdAt)),
        path: `/items/${item.id}`,
        title: item.title,
        // タイトルで当たったなら、そこは行の見出しにもう出ている。
        // メモで当たったときだけ、その周りを抜き出して見せる
        excerpt: item.note ? excerptAround(item.note, query.q) : '',
        item: hitItem(item),
      })
    }
  }

  if (query.kind === 'all' || query.kind === 'section') {
    const found = source.sections
      .filter((section) => section.syncState !== 'pending_delete')
      .filter((section) => hit(section.body) && inRange(section.date))
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))

    for (const section of found) {
      // 宛先のタスクが条件から外れていれば出さない（サーバーの内部結合と同じ）
      const item = byId.get(section.itemId)
      if (!item) continue

      hits.push({
        id: `section:${section.id}`,
        kind: 'section',
        date: section.date,
        path: `/items/${item.id}`,
        title: item.title,
        excerpt: excerptAround(section.body, query.q),
        item: hitItem(item),
      })
    }
  }

  /*
   * タグは Item に付くものなので、日記には当てはまらない。タグで絞った
   * ときは日記を混ぜない（サーバー側と同じ理由・同じ扱い）。
   */
  const excludesDiary = Boolean(query.tag)
  if ((query.kind === 'all' && !excludesDiary) || query.kind === 'diary') {
    const found = source.diaries
      .filter((diary) => diary.syncState !== 'pending_delete')
      .filter((diary) => hit(diary.body) && inRange(diary.date))
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))

    for (const diary of found) {
      hits.push({
        id: `diary:${diary.date}`,
        kind: 'diary',
        date: diary.date,
        path: `/diary/${diary.date}`,
        title: '日記',
        excerpt: excerptAround(diary.body, query.q),
        item: null,
      })
    }
  }

  return sortSearchHits(hits)
}

/**
 * その行が、**いまの手元の状態でも**この検索に合っているか。
 *
 * サーバーの応答は聞きに行った時点の姿なので、そのあとに手元で行った操作
 * （完了にした・消した・タグを外した）が入っていない。当てずにいると、
 * 検索結果から完了にしたタスクが未完了の結果に残り続ける。
 *
 * 手元に写しが無いものは、判断できないのでそのまま出す（他の端末で
 * 作られた直後のタスクなど）。言葉が当たるかどうかは見ない。題を書き
 * 換えている最中に行が消えると、書いている場所を見失う。
 */
export function stillMatches(
  hit: SearchHit,
  local: LocalItem | undefined,
  query: SearchQuery,
): boolean {
  if (!hit.item || !local) return true
  return matchesConditions(local, query)
}

/** タスクに掛かる条件（消していないか・未完了 / 完了・タグ）。 */
function matchesConditions(item: LocalItem, query: SearchQuery): boolean {
  // 消して、まだ送れていないもの。取り消せるよう記録は残してある
  if (item.syncState === 'pending_delete') return false

  const closed = item.status === 'closed'
  if (query.view === 'completed' ? !closed : closed) return false

  if (query.tag && !item.tags.includes(query.tag)) return false
  return true
}

/** 行に添えるタスク（一覧のカードと同じ見た目で出すのに要るぶん）。 */
function hitItem(item: LocalItem): SearchHit['item'] {
  return {
    id: item.id,
    status: item.status,
    priority: item.priority,
    tags: item.tags,
    dueAt: item.dueAt,
    dueHasTime: item.dueHasTime,
  }
}
