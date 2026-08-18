import { beforeEach, describe, expect, it } from 'vitest'
import {
  allItems,
  getItem,
  lastFetchedAt,
  listConflicts,
  markSynced,
  mergeServerItems,
  pruneConflicts,
  putConflict,
  putItem,
  toLocalItem,
} from '~/utils/offline/todo-repository'
import { itemDto, resetLocalDatabase } from '../helpers'

describe('TodoRepository', () => {
  beforeEach(resetLocalDatabase)

  it('サーバーの一覧をローカルへ写す', async () => {
    const item = itemDto({ title: '買い物' })
    await mergeServerItems([item], new Date('2026-08-18T10:00:00.000Z'))

    const stored = await getItem(item.id)
    expect(stored?.title).toBe('買い物')
    expect(stored?.syncState).toBe('synced')
    // 競合の基準は、サーバーで見た updatedAt
    expect(stored?.baseUpdatedAt).toBe(item.updatedAt)

    expect((await lastFetchedAt())?.toISOString()).toBe('2026-08-18T10:00:00.000Z')
  })

  it('まだ送れていない変更はサーバーの内容で上書きしない', async () => {
    const item = itemDto({ title: 'もとの題' })
    await mergeServerItems([item])

    const local = await getItem(item.id)
    await putItem({ ...local!, title: 'オフラインで直した題', syncState: 'pending_update' })

    await mergeServerItems([{ ...item, title: 'もとの題' }])

    const after = await getItem(item.id)
    expect(after?.title).toBe('オフラインで直した題')
    expect(after?.syncState).toBe('pending_update')
  })

  it('サーバーに無くなった同期済みの Item は消す', async () => {
    const kept = itemDto()
    const removed = itemDto()
    await mergeServerItems([kept, removed])

    await mergeServerItems([kept])

    const ids = (await allItems()).map((item) => item.id)
    expect(ids).toEqual([kept.id])
  })

  it('サーバーに無くても、未送信の Item は残す', async () => {
    const draft = itemDto()
    await putItem(toLocalItem(draft, 'pending_create'))

    await mergeServerItems([])

    expect(await getItem(draft.id)).toBeDefined()
  })

  it('送信が通ったら同期済みにする', async () => {
    const item = itemDto({ title: 'ローカルの題' })
    await putItem(toLocalItem(item, 'pending_update'))

    const server = { ...item, title: 'サーバーの題', updatedAt: '2026-08-18T12:00:00.000Z' }
    await markSynced(server)

    const stored = await getItem(item.id)
    expect(stored?.title).toBe('サーバーの題')
    expect(stored?.syncState).toBe('synced')
  })

  it('あとに続く操作があるときは、基準だけ進めて内容は保つ', async () => {
    const item = itemDto({ title: 'ローカルの題' })
    await putItem(toLocalItem(item, 'pending_update'))

    await markSynced(
      { ...item, title: '送信が通った時点の題', updatedAt: '2026-08-18T12:00:00.000Z' },
      { keepPending: true },
    )

    const stored = await getItem(item.id)
    expect(stored?.title).toBe('ローカルの題')
    expect(stored?.syncState).toBe('pending_update')
    expect(stored?.baseUpdatedAt).toBe('2026-08-18T12:00:00.000Z')
  })

  it('古い競合の記録は捨てる', async () => {
    await putConflict({
      itemId: 'a',
      title: '古い',
      detectedAt: '2026-08-01T00:00:00.000Z',
      discarded: {},
      reason: 'server_newer',
    })
    await putConflict({
      itemId: 'b',
      title: '新しい',
      detectedAt: '2026-08-18T00:00:00.000Z',
      discarded: {},
      reason: 'server_newer',
    })

    await pruneConflicts(new Date('2026-08-18T00:00:00.000Z'))

    expect((await listConflicts()).map((record) => record.itemId)).toEqual(['b'])
  })
})
