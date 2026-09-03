import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_ATTEMPTS,
  cancelOperations,
  enqueueOperation,
  listOperations,
  nextOperation,
  recordFailure,
  removeOperation,
  retryGivenUp,
  summarize,
} from '~/utils/offline/sync-queue'
import { itemDto, resetLocalDatabase } from '../helpers'

describe('SyncQueue', () => {
  beforeEach(resetLocalDatabase)

  it('積んだ順に取り出す', async () => {
    const first = await enqueueOperation(
      { kind: 'create', itemIds: ['a'], payload: { id: 'a', text: '1件目' } },
      new Date('2026-08-18T00:00:00.000Z'),
    )
    await enqueueOperation(
      { kind: 'create', itemIds: ['b'], payload: { id: 'b', text: '2件目' } },
      new Date('2026-08-18T00:00:01.000Z'),
    )

    expect((await nextOperation())?.opId).toBe(first.opId)

    await removeOperation(first.seq)
    expect((await nextOperation())?.itemIds).toEqual(['b'])
  })

  it('同じ宛先が待機中なら、後ろを追い越さない', async () => {
    const now = new Date('2026-08-18T00:00:00.000Z')
    const head = await enqueueOperation(
      { kind: 'patch', itemIds: ['a'], payload: { id: 'a', patch: { status: 'closed' } } },
      now,
    )
    const later = await enqueueOperation(
      { kind: 'delete', itemIds: ['a'], payload: { id: 'a' } },
      new Date(now.getTime() + 1),
    )

    await recordFailure(head.seq, '通信できませんでした', { now })

    // 待機が明けるまでは、同じ Item の後続も出さない（順序を守る）
    expect(await nextOperation(now)).toBeNull()
    expect(later.seq).toBeGreaterThan(head.seq)
    expect((await nextOperation(new Date(now.getTime() + 60_000)))?.opId).toBe(head.opId)
  })

  /**
   * 詰まった1つの操作が、関係のない変更まで止めない
   * （docs/12-offline.md 12.7）。列ごと止めていたため、送れないタスクの
   * 操作があるだけで日記が送られず、●が灰色のまま動かなかった。
   */
  it('別の宛先は、待機中の操作を追い越して送る', async () => {
    const now = new Date('2026-08-18T00:00:00.000Z')
    const head = await enqueueOperation(
      { kind: 'patch', itemIds: ['a'], payload: { id: 'a', patch: { status: 'closed' } } },
      now,
    )
    const other = await enqueueOperation(
      { kind: 'delete', itemIds: ['b'], payload: { id: 'b' } },
      new Date(now.getTime() + 1),
    )
    const diary = await enqueueOperation(
      {
        kind: 'diary_save',
        itemIds: [],
        payload: { date: '2026-08-18', body: '今日のこと' },
      },
      new Date(now.getTime() + 2),
    )

    await recordFailure(head.seq, 'サーバーが応答しませんでした', { now })

    // 詰まっている操作の待機中（送り直しは1秒後）に見る
    const waiting = new Date(now.getTime() + 500)

    // 別のタスク → 日記の順に、積んだ順のまま送れる
    expect((await nextOperation(waiting))?.opId).toBe(other.opId)
    await removeOperation(other.seq)
    expect((await nextOperation(waiting))?.opId).toBe(diary.opId)

    // 待機が明ければ、詰まっていた操作も送れる
    await removeOperation(diary.seq)
    expect(await nextOperation(waiting)).toBeNull()
    expect((await nextOperation(new Date(now.getTime() + 60_000)))?.opId).toBe(head.opId)
  })

  it('同じ日記への操作は、待機中なら追い越さない', async () => {
    const now = new Date('2026-08-18T00:00:00.000Z')
    const head = await enqueueOperation(
      {
        kind: 'diary_save',
        itemIds: [],
        payload: { date: '2026-08-18', body: '書きかけ' },
      },
      now,
    )
    await enqueueOperation(
      {
        kind: 'diary_save',
        itemIds: [],
        payload: { date: '2026-08-19', body: '次の日' },
      },
      new Date(now.getTime() + 1),
    )

    await recordFailure(head.seq, 'サーバーが応答しませんでした', { now })

    // 別の日は送れるが、同じ日の後続は待たせる
    const waiting = new Date(now.getTime() + 500)
    expect((await nextOperation(waiting))?.payload).toMatchObject({ date: '2026-08-19' })
  })

  it('失敗しても操作は消さず、回数を数える', async () => {
    const operation = await enqueueOperation({
      kind: 'delete',
      itemIds: ['a'],
      payload: { id: 'a' },
    })

    await recordFailure(operation.seq, 'サーバーが応答しませんでした')

    const [stored] = await listOperations()
    expect(stored?.attempts).toBe(1)
    expect(stored?.lastError).toBe('サーバーが応答しませんでした')
    expect(stored?.givenUp).toBe(false)
  })

  it('回数を使い切ったら自動での送り直しをやめる（無限に投げない）', async () => {
    const operation = await enqueueOperation({
      kind: 'delete',
      itemIds: ['a'],
      payload: { id: 'a' },
    })

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await recordFailure(operation.seq, '駄目でした')
    }

    const [stored] = await listOperations()
    expect(stored?.givenUp).toBe(true)
    // 諦めた操作は列を塞がない
    expect(await nextOperation()).toBeNull()

    await retryGivenUp()
    expect((await nextOperation())?.opId).toBe(operation.opId)
  })

  it('内容の問題ならその場で諦める', async () => {
    const operation = await enqueueOperation({
      kind: 'patch',
      itemIds: ['a'],
      payload: { id: 'a', patch: { title: '' }, baseUpdatedAt: null },
    })

    await recordFailure(operation.seq, 'タイトルは空にできません', { permanent: true })

    const summary = await summarize()
    expect(summary.pending).toBe(1)
    expect(summary.givenUp).toBe(1)
    expect(summary.lastError).toBe('タイトルは空にできません')
  })

  /**
   * 「未同期（n）」だけでは、失敗しているのか・待っているだけなのかが
   * 分からない。画面に出すための材料をまとめて返す（docs/12-offline.md 12.8）。
   */
  it('次に送る操作と、種類ごとの内訳を返す', async () => {
    const first = await enqueueOperation(
      { kind: 'section_save', itemIds: ['a'], payload: { id: 's1', itemId: 'a', date: '2026-08-22', body: 'あ', pinned: false } },
      new Date('2026-08-22T00:00:00.000Z'),
    )
    await enqueueOperation(
      { kind: 'section_save', itemIds: ['b'], payload: { id: 's2', itemId: 'b', date: '2026-08-22', body: 'い', pinned: false } },
      new Date('2026-08-22T00:00:01.000Z'),
    )
    await enqueueOperation(
      { kind: 'patch', itemIds: ['a'], payload: { id: 'a', patch: { status: 'closed' }, baseUpdatedAt: null } },
      new Date('2026-08-22T00:00:02.000Z'),
    )

    // 先頭が諦めていれば、次に送るのはその後ろ
    await recordFailure(first.seq, '通信できませんでした', {
      permanent: true,
      now: new Date('2026-08-22T00:00:03.000Z'),
    })

    const summary = await summarize()

    expect(summary.pending).toBe(3)
    expect(summary.kinds).toEqual([
      { kind: 'section_save', count: 2 },
      { kind: 'patch', count: 1 },
    ])
    expect(summary.head).toMatchObject({
      kind: 'section_save',
      attempts: 0,
      givenUp: false,
    })
  })

  it('まだ送っていない操作を取り消せる', async () => {
    const item = itemDto()
    await enqueueOperation({
      kind: 'delete',
      itemIds: [item.id],
      payload: { id: item.id },
    })
    await enqueueOperation({ kind: 'delete', itemIds: ['other'], payload: { id: 'other' } })

    const cancelled = await cancelOperations(
      (operation) => operation.kind === 'delete' && operation.itemIds.includes(item.id),
    )

    expect(cancelled).toBe(1)
    expect((await listOperations()).map((operation) => operation.itemIds)).toEqual([
      ['other'],
    ])
  })
})
