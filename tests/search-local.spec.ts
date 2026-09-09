import { describe, expect, it } from 'vitest'
import type { LocalDiary, LocalItem, LocalSection } from '~/utils/offline/local-database'
import { toLocalItem } from '~/utils/offline/todo-repository'
import { searchLocally, stillMatches } from '~/utils/search-local'
import { mergeSearchHits } from '~~/shared/utils/search'
import type { SearchHit, SearchQuery } from '~~/shared/types/search'
import { itemDto } from './helpers'

/**
 * 手元だけで組み立てる検索結果（docs/03-functional-spec.md 3.6）。
 *
 * サーバーへ聞きに行っている間、待たせずに出すためのもの。当てる条件は
 * `server/api/search.get.ts` と同じでなければならない。ずれていると、
 * 応答が届いた瞬間に行が増えたり消えたりする。
 */

function query(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return { q: '牛乳', kind: 'all', view: 'open', tag: '', from: '', to: '', ...overrides }
}

function item(overrides: Parameters<typeof itemDto>[0] = {}): LocalItem {
  return toLocalItem(itemDto(overrides))
}

function section(overrides: Partial<LocalSection> = {}): LocalSection {
  return {
    id: `section-${Math.random()}`,
    itemId: 'x',
    date: '2026-09-01',
    body: '',
    position: 0,
    pinned: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    syncState: 'synced',
    ...overrides,
  }
}

function diary(overrides: Partial<LocalDiary> = {}): LocalDiary {
  return {
    date: '2026-09-01',
    body: '',
    updatedAt: '2026-09-01T00:00:00.000Z',
    syncState: 'synced',
    ...overrides,
  }
}

function search(
  source: Partial<Parameters<typeof searchLocally>[0]>,
  conditions = query(),
) {
  return searchLocally(
    { items: [], sections: [], diaries: [], ...source },
    conditions,
  )
}

describe('searchLocally', () => {
  it('タスク名とメモの両方から拾う', () => {
    const byTitle = item({ title: '牛乳を買う' })
    const byNote = item({ title: '買い物', note: '牛乳は低脂肪のもの' })
    const other = item({ title: '掃除機を出す' })

    const hits = search({ items: [byTitle, byNote, other] })

    expect(hits.map((hit) => hit.id)).toEqual([`item:${byTitle.id}`, `item:${byNote.id}`])
    // タイトルで当たった行は、見出しにもう出ているので抜粋を出さない
    expect(hits[0]?.excerpt).toBe('')
    expect(hits[1]?.excerpt).toBe('牛乳は低脂肪のもの')
  })

  it('大文字小文字は区別しない（ILIKE と同じ）', () => {
    const hits = search({ items: [item({ title: 'Milk を買う' })] }, query({ q: 'milk' }))

    expect(hits).toHaveLength(1)
  })

  it('未完了 / 完了で絞る', () => {
    const open = item({ title: '牛乳を買う' })
    const closed = item({ title: '牛乳を飲む', status: 'closed' })

    expect(search({ items: [open, closed] }).map((hit) => hit.title)).toEqual([
      '牛乳を買う',
    ])
    expect(
      search({ items: [open, closed] }, query({ view: 'completed' })).map(
        (hit) => hit.title,
      ),
    ).toEqual(['牛乳を飲む'])
  })

  it('消して、まだ送れていないものは出さない', () => {
    const removed: LocalItem = { ...item({ title: '牛乳を買う' }), syncState: 'pending_delete' }

    expect(search({ items: [removed] })).toEqual([])
  })

  it('タグで絞る。タグ指定のときは日記を混ぜない', () => {
    const tagged = item({ title: '牛乳を買う', tags: ['買い物'] })
    const untagged = item({ title: '牛乳の賞味期限' })
    const written = diary({ body: '牛乳を切らした' })

    const hits = search(
      { items: [tagged, untagged], diaries: [written] },
      query({ tag: '買い物' }),
    )

    expect(hits.map((hit) => hit.title)).toEqual(['牛乳を買う'])
  })

  it('期間で絞る（タスクは作成日、記録と日記はその日付）', () => {
    const old = item({ title: '牛乳を買う', createdAt: '2026-08-01T00:00:00.000+09:00' })
    const recent = item({ title: '牛乳を買い足す', createdAt: '2026-09-05T00:00:00.000+09:00' })

    const hits = search({ items: [old, recent] }, query({ from: '2026-09-01' }))

    expect(hits.map((hit) => hit.title)).toEqual(['牛乳を買い足す'])
  })

  it('作業記録は、宛先のタスクが条件に合うときだけ出す', () => {
    // タスク名は当たらないようにする（見たいのは記録の行の扱い）
    const closed = item({ title: '買い物', status: 'closed' })
    const record = section({ itemId: closed.id, body: '牛乳を切らしていた' })

    // 未完了側では、完了したタスクの記録は出さない（サーバーの内部結合と同じ）
    expect(search({ items: [closed], sections: [record] })).toEqual([])
    expect(
      search({ items: [closed], sections: [record] }, query({ view: 'completed' })).map(
        (hit) => hit.kind,
      ),
    ).toEqual(['section'])
  })

  it('種別をまたいで、日付の新しい順に混ぜる', () => {
    const task = item({ title: '牛乳を買う', createdAt: '2026-09-02T00:00:00.000+09:00' })
    const record = section({ itemId: task.id, date: '2026-09-04', body: '牛乳の話' })
    const written = diary({ date: '2026-09-03', body: '牛乳を飲んだ' })

    const hits = search({ items: [task], sections: [record], diaries: [written] })

    expect(hits.map((hit) => hit.kind)).toEqual(['section', 'diary', 'item'])
  })

  it('探す言葉が空なら何も返さない', () => {
    expect(search({ items: [item({ title: '牛乳を買う' })] }, query({ q: '  ' }))).toEqual([])
  })
})

/**
 * サーバーの応答が届いたら重ねる。手元にしか無い行（オフラインで追加した
 * タスク）は残し、両方にある行はサーバーのものを採る。
 */
describe('mergeSearchHits', () => {
  function hit(id: string, date: string, excerpt = ''): SearchHit {
    return { id, kind: 'item', date, path: '/', title: id, excerpt, item: null }
  }

  it('同じ行はサーバーのものを採る（抜粋やタグが揃っている）', () => {
    const merged = mergeSearchHits(
      [hit('item:a', '2026-09-01', 'サーバー')],
      [hit('item:a', '2026-09-01', '手元')],
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]?.excerpt).toBe('サーバー')
  })

  it('手元にしか無い行は残し、日付順に並べ直す', () => {
    const merged = mergeSearchHits(
      [hit('item:a', '2026-09-01')],
      [hit('item:b', '2026-09-05')],
    )

    expect(merged.map((row) => row.id)).toEqual(['item:b', 'item:a'])
  })
})

/**
 * 応答は聞きに行った時点の姿なので、そのあとに手元で行った操作は入っていない。
 * 検索結果から完了にしたタスクが、未完了の結果に残り続けないようにする。
 */
describe('stillMatches', () => {
  const row: SearchHit = {
    id: 'item:a',
    kind: 'item',
    date: '2026-09-01',
    path: '/items/a',
    title: '牛乳を買う',
    excerpt: '',
    item: { id: 'a', status: 'backlog', priority: null, tags: [], dueAt: null, dueHasTime: false },
  }

  it('完了にしたら、未完了の結果から落ちる', () => {
    const local = item({ id: 'a', title: '牛乳を買う', status: 'closed' })

    expect(stillMatches(row, local, query())).toBe(false)
    expect(stillMatches(row, local, query({ view: 'completed' }))).toBe(true)
  })

  it('消した（まだ送っていない）ものも落ちる', () => {
    const local: LocalItem = {
      ...item({ id: 'a', title: '牛乳を買う' }),
      syncState: 'pending_delete',
    }

    expect(stillMatches(row, local, query())).toBe(false)
  })

  it('手元に写しが無ければ、そのまま出す（他の端末で作られた直後）', () => {
    expect(stillMatches(row, undefined, query())).toBe(true)
  })

  it('日記の行は、タスクの条件では落とさない', () => {
    const diaryRow: SearchHit = { ...row, id: 'diary:2026-09-01', kind: 'diary', item: null }

    expect(stillMatches(diaryRow, undefined, query())).toBe(true)
  })
})
