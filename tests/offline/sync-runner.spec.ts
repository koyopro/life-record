import { describe, expect, it } from 'vitest'
import type { PendingOperation } from '~/utils/offline/local-database'
import { runOperation, withSendTimeout } from '~/utils/offline/sync-runner'
import { fakeServer, httpError, itemDto, networkError } from '../helpers'

function operation(overrides: Partial<PendingOperation>): PendingOperation {
  return {
    seq: 1,
    opId: 'op-1',
    kind: 'patch',
    itemIds: ['item-1'],
    payload: { id: 'item-1', patch: { status: 'closed' }, baseUpdatedAt: null },
    createdAt: '2026-08-18T00:00:00.000Z',
    attempts: 0,
    nextAttemptAt: '2026-08-18T00:00:00.000Z',
    givenUp: false,
    lastError: null,
    ...overrides,
  }
}

describe('sync-runner', () => {
  it('作成は id と入力をそのまま送る', async () => {
    const item = itemDto()
    const server = fakeServer(() => item)

    const outcome = await runOperation(
      operation({
        kind: 'create',
        itemIds: [item.id],
        payload: { id: item.id, text: '請求書を出す !1' },
      }),
      server.request,
    )

    expect(server.calls[0]).toMatchObject({
      path: '/api/items',
      method: 'POST',
      body: { id: item.id, text: '請求書を出す !1' },
    })
    expect(outcome).toEqual({ type: 'done', item })
  })

  it('更新には競合の基準を添えて送る', async () => {
    const item = itemDto()
    const server = fakeServer(() => item)

    await runOperation(
      operation({
        payload: {
          id: item.id,
          patch: { status: 'closed' },
          baseUpdatedAt: '2026-08-18T00:00:00.000Z',
        },
      }),
      server.request,
    )

    expect(server.calls[0]).toMatchObject({
      path: `/api/items/${item.id}`,
      method: 'PATCH',
      body: { status: 'closed', baseUpdatedAt: '2026-08-18T00:00:00.000Z' },
    })
  })

  it('通信できないときは送り直す（オフライン扱い）', async () => {
    const server = fakeServer(() => {
      throw networkError()
    })

    const outcome = await runOperation(operation({}), server.request)

    expect(outcome).toMatchObject({ type: 'retry', offline: true })
  })

  it('サーバーの一時的な不調は送り直す', async () => {
    const server = fakeServer(() => {
      throw httpError(503)
    })

    const outcome = await runOperation(operation({}), server.request)

    expect(outcome).toMatchObject({ type: 'retry', offline: false })
  })

  it('認証が切れているだけなら消さずに送り直す', async () => {
    const server = fakeServer(() => {
      throw httpError(401)
    })

    expect(await runOperation(operation({}), server.request)).toMatchObject({
      type: 'retry',
    })
  })

  it('409 は競合として、サーバーの内容を持ち帰る', async () => {
    const server = itemDto({ title: '他の端末で変えた題' })
    const fake = fakeServer(() => {
      throw httpError(409, { message: '他の端末で変更されています', data: { item: server } })
    })

    const outcome = await runOperation(operation({}), fake.request)

    expect(outcome).toEqual({ type: 'conflict', reason: 'server_newer', server })
  })

  it('消えている Item への更新は競合として扱う', async () => {
    const fake = fakeServer(() => {
      throw httpError(404, { message: '見つかりません' })
    })

    expect(await runOperation(operation({}), fake.request)).toEqual({
      type: 'conflict',
      reason: 'server_deleted',
      server: null,
    })
  })

  it('すでに消えている Item の削除は成功と同じ（冪等）', async () => {
    const fake = fakeServer(() => {
      throw httpError(404, { message: '見つかりません' })
    })

    const outcome = await runOperation(
      operation({ kind: 'delete', payload: { id: 'item-1' } }),
      fake.request,
    )

    expect(outcome).toEqual({ type: 'done' })
  })

  it('内容が不正なら諦める（投げ続けても通らない）', async () => {
    const fake = fakeServer(() => {
      throw httpError(400, { message: 'タイトルは空にできません' })
    })

    expect(await runOperation(operation({}), fake.request)).toEqual({
      type: 'failed',
      message: 'タイトルは空にできません',
    })
  })
  /**
   * 応答が返ってこない送信が1つあると、列がそこで永久に止まる（送信は1つずつ、
   * 前が終わってから次へ進む）。画面には「未同期」と点滅する●が出たままで、
   * 再読み込みでも直らない（docs/12-offline.md 12.7）。
   */
  describe('送信の上限', () => {
    it('応答が返らなければ打ち切り、送り直しの対象にする', async () => {
      // いつまでも終わらない送信
      const stuck = () => new Promise<never>(() => {})

      const outcome = await runOperation(
        operation({}),
        withSendTimeout(stuck, 5),
      )

      expect(outcome).toMatchObject({ type: 'retry', offline: true })
      expect((outcome as { message: string }).message).toContain('終わりませんでした')
    })

    it('打ち切るときは通信そのものも止める', async () => {
      let signal: AbortSignal | undefined
      const stuck = (_path: string, options?: { signal?: AbortSignal }) => {
        signal = options?.signal
        return new Promise<never>(() => {})
      }

      await runOperation(operation({}), withSendTimeout(stuck, 5))

      expect(signal?.aborted).toBe(true)
    })

    it('間に合った送信はそのまま通す', async () => {
      const item = itemDto()
      const server = fakeServer(() => item)

      const outcome = await runOperation(
        operation({ payload: { id: item.id, patch: { status: 'closed' }, baseUpdatedAt: null } }),
        withSendTimeout(server.request, 5_000),
      )

      expect(outcome).toMatchObject({ type: 'done', item })
    })
  })
})
