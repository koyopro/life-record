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

  it('先頭が待機中なら、後ろを追い越さない', async () => {
    const now = new Date('2026-08-18T00:00:00.000Z')
    const head = await enqueueOperation(
      { kind: 'delete', itemIds: ['a'], payload: { id: 'a' } },
      now,
    )
    await enqueueOperation(
      { kind: 'delete', itemIds: ['b'], payload: { id: 'b' } },
      new Date(now.getTime() + 1),
    )

    await recordFailure(head.seq, '通信できませんでした', { now })

    // 待機が明けるまでは何も返さない（順序を守る）
    expect(await nextOperation(now)).toBeNull()
    expect((await nextOperation(new Date(now.getTime() + 60_000)))?.opId).toBe(head.opId)
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
