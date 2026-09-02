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
  setItemBody,
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

  /**
   * 取得（GET）と保存（PATCH）は別々に飛ぶので、**保存より前に出した取得の
   * 応答が保存の後で届く**ことがある（docs/15-client-state.md 14.2 の 4）。
   * その応答で戻すと、入力したそばから巻き戻って見える。
   */
  it('応答を作った時刻より後に送り終えた分は、その応答で戻さない', async () => {
    const item = itemDto({ title: 'もとの題' })
    await mergeServerItems([item], new Date(), '2026-09-01T10:00:00.000Z')

    // 送信が通って、サーバーがこの時刻を打った（取得の応答より後）
    await markSynced({
      ...item,
      title: '直した題',
      updatedAt: '2026-09-01T10:00:05.000Z',
    })

    // 取りに行ったのは直す前。応答が後から届く
    await mergeServerItems([item], new Date(), '2026-09-01T10:00:00.000Z')

    const after = await getItem(item.id)
    expect(after?.title).toBe('直した題')
    expect(after?.syncState).toBe('synced')
  })

  it('応答を作った時刻より前に送り終えた分は、応答の内容で更新する', async () => {
    const item = itemDto({ title: 'もとの題' })
    await mergeServerItems([item], new Date(), '2026-09-01T10:00:00.000Z')

    // 別の端末が直した分が、後から出した応答に入っている
    await mergeServerItems(
      [{ ...item, title: '別の端末の題', updatedAt: '2026-09-01T10:00:05.000Z' }],
      new Date(),
      '2026-09-01T10:00:10.000Z',
    )

    expect((await getItem(item.id))?.title).toBe('別の端末の題')
  })

  it('応答を作った時刻より後に増えた分は、応答に無くても消さない', async () => {
    const added = itemDto({ updatedAt: '2026-09-01T10:00:05.000Z' })
    await markSynced(added)

    await mergeServerItems([], new Date(), '2026-09-01T10:00:00.000Z')

    expect(await getItem(added.id)).toBeDefined()
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

  describe('setItemBody', () => {
    it('一覧カードに出す本文の写しだけを差し替える', async () => {
      const item = itemDto({ title: '買い物', body: '書く前' })
      await mergeServerItems([item])

      await setItemBody(item.id, '書いたあと')

      const stored = await getItem(item.id)
      expect(stored?.body).toBe('書いたあと')
      // 本文はサーバー（Section）へ既に届いている。送信の対象にはしない
      expect(stored?.syncState).toBe('synced')
      expect(stored?.title).toBe('買い物')
    })

    it('まだローカルに無い Item は何もしない', async () => {
      await setItemBody('00000000-0000-4000-8000-999999999999', '書いたあと')
      expect(await allItems()).toEqual([])
    })
  })
})
