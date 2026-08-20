import { beforeEach, describe, expect, it } from 'vitest'
import type { ItemDto } from '~~/shared/types/item'
import { allItems, getItem, listConflicts, mergeServerItems } from '~/utils/offline/todo-repository'
import {
  applyTodoTags,
  createTodo,
  patchTodos,
  removeTodos,
  restoreTodos,
} from '~/utils/offline/todo-actions'
import { listOperations } from '~/utils/offline/sync-queue'
import { drainQueue } from '~/utils/offline/sync-engine'
import { fakeServer, httpError, itemDto, networkError, type RecordedRequest } from '../helpers'

/**
 * オフラインでの操作と、オンラインに戻ってからの同期の筋道
 * （docs/12-offline.md 12.10 のテスト観点）。
 *
 * サーバーの代わりに、Item を1つ持つだけの簡単な実装を置いて確かめる。
 */

interface Server {
  request: ReturnType<typeof fakeServer>['request']
  calls: RecordedRequest[]
  items: Map<string, ItemDto>
  /** 落ちている状態。オフラインの再現に使う。 */
  down: boolean
}

function server(seed: ItemDto[] = []): Server {
  const items = new Map(seed.map((item) => [item.id, item]))
  const state = { down: false }

  const fake = fakeServer((path, options) => {
    if (state.down) throw networkError()

    const method = options?.method ?? 'GET'
    const body = options?.body as Record<string, never> | undefined

    if (path === '/api/items' && method === 'POST') {
      const id = String(body!.id)
      // 同じ id で二度来ても作り直さない（server/api/items.post.ts と同じ）
      const existing = items.get(id)
      if (existing) return existing
      const created = itemDto({ id, title: String(body!.text), updatedAt: stamp() })
      items.set(id, created)
      return created
    }

    if (path === '/api/items/tags' && method === 'POST') {
      const id = String((body!.ids as unknown as string[])[0])
      const current = items.get(id)
      if (!current) throw httpError(404, { message: '見つかりません' })
      const tags = new Set(
        current.tags.filter((name) => !(body!.remove as unknown as string[]).includes(name)),
      )
      for (const name of body!.add as unknown as string[]) tags.add(name)
      const next = { ...current, tags: [...tags].sort(), updatedAt: stamp() }
      items.set(id, next)
      return [next]
    }

    if (path === '/api/items/restore' && method === 'POST') {
      const snapshot = body as unknown as ItemDto
      const existing = items.get(snapshot.id)
      if (existing) return existing
      items.set(snapshot.id, snapshot)
      return snapshot
    }

    const id = path.replace('/api/items/', '')

    if (method === 'PATCH') {
      const current = items.get(id)
      if (!current) throw httpError(404, { message: '見つかりません' })
      const { baseUpdatedAt, ...patch } = body as Record<string, unknown>
      if (baseUpdatedAt && baseUpdatedAt !== current.updatedAt) {
        throw httpError(409, {
          message: '他の端末で変更されています',
          data: { item: current },
        })
      }
      const next = { ...current, ...patch, updatedAt: stamp() } as ItemDto
      items.set(id, next)
      return next
    }

    if (method === 'DELETE') {
      const current = items.get(id)
      if (!current) throw httpError(404, { message: '見つかりません' })
      items.delete(id)
      return { ...current, sections: [], primarySectionId: null }
    }

    throw new Error(`想定していない呼び出し: ${method} ${path}`)
  })

  return {
    request: fake.request,
    calls: fake.calls,
    items,
    get down() {
      return state.down
    },
    set down(value: boolean) {
      state.down = value
    },
  }
}

let clock = 0
function stamp(): string {
  clock += 1
  return new Date(Date.UTC(2026, 7, 18, 0, 0, clock)).toISOString()
}

/**
 * 列を流す。
 *
 * 失敗した操作は間隔を空けてから送り直すことになっているので、呼ぶたびに
 * 時計を1時間進める（本番では目覚ましかオンライン復帰の合図で動く）。
 */
let syncClock = 0
function sync(target: Server) {
  syncClock += 60 * 60 * 1000
  const offset = syncClock
  return drainQueue({
    request: target.request,
    now: () => new Date(Date.now() + offset),
  })
}

describe('オンラインでの操作', () => {
  beforeEach(async () => {
    const { resetLocalDatabase } = await import('../helpers')
    await resetLocalDatabase()
  })

  it('追加するとサーバーへ送られ、同期済みになる', async () => {
    const remote = server()
    const draft = itemDto({ title: '請求書を出す' })

    await createTodo(draft, '請求書を出す')
    expect((await getItem(draft.id))?.syncState).toBe('pending_create')

    const result = await sync(remote)

    expect(result.sent).toBe(1)
    expect(remote.items.has(draft.id)).toBe(true)
    expect((await getItem(draft.id))?.syncState).toBe('synced')
    expect(await listOperations()).toEqual([])
  })

  it('ステータスの変更が送られる', async () => {
    const item = itemDto({ status: 'backlog' })
    const remote = server([item])
    await mergeServerItems([item])

    await patchTodos([item.id], { status: 'closed' })
    await sync(remote)

    expect(remote.items.get(item.id)?.status).toBe('closed')
    const stored = await getItem(item.id)
    expect(stored?.status).toBe('closed')
    expect(stored?.syncState).toBe('synced')
    // 次の変更の基準は、サーバーが返した updatedAt
    expect(stored?.baseUpdatedAt).toBe(remote.items.get(item.id)?.updatedAt)
  })
})

describe('オフラインでの操作', () => {
  beforeEach(async () => {
    const { resetLocalDatabase } = await import('../helpers')
    await resetLocalDatabase()
  })

  it('オフラインでも追加・編集・ステータス変更ができ、未同期として残る', async () => {
    const existing = itemDto({ title: '既にあるタスク' })
    const remote = server([existing])
    await mergeServerItems([existing])

    remote.down = true

    const draft = itemDto({ title: 'オフラインで足したタスク' })
    await createTodo(draft, 'オフラインで足したタスク')
    await patchTodos([existing.id], { status: 'closed' })
    await patchTodos([existing.id], { priority: 1 })

    // 画面に出る内容は、すぐに変わっている
    const stored = await getItem(existing.id)
    expect(stored?.status).toBe('closed')
    expect(stored?.priority).toBe(1)
    expect(stored?.syncState).toBe('pending_update')
    expect((await getItem(draft.id))?.syncState).toBe('pending_create')

    // 送ろうとしても届かないが、操作は消えない
    const result = await sync(remote)
    expect(result).toEqual({ sent: 0, stoppedBy: 'retry' })
    expect((await listOperations()).length).toBe(3)
  })

  it('オフラインで消したものを、送る前なら取り消せる', async () => {
    const item = itemDto()
    const remote = server([item])
    await mergeServerItems([item])
    remote.down = true

    await removeTodos([item.id])
    expect((await getItem(item.id))?.syncState).toBe('pending_delete')

    await restoreTodos([item.id])

    expect((await getItem(item.id))?.syncState).toBe('synced')
    // 送らずに済ませる
    expect(await listOperations()).toEqual([])
  })
})

describe('オンライン復帰', () => {
  beforeEach(async () => {
    const { resetLocalDatabase } = await import('../helpers')
    await resetLocalDatabase()
  })

  it('溜まっていた操作が積んだ順に送られ、未同期が解ける', async () => {
    const item = itemDto({ title: 'もとの題' })
    const remote = server([item])
    await mergeServerItems([item])

    remote.down = true
    const draft = itemDto({ title: '新しいタスク' })
    await createTodo(draft, '新しいタスク')
    await patchTodos([item.id], { title: '直した題' })
    await applyTodoTags([item.id], ['仕事'], [])
    await sync(remote)

    remote.down = false
    // 繋がってからの呼び出しだけを見る（届かなかったぶんは数に入れない）
    const before = remote.calls.length
    const result = await sync(remote)

    expect(result.stoppedBy).toBe('empty')
    expect(remote.calls.slice(before).map((call) => call.path)).toEqual([
      '/api/items',
      `/api/items/${item.id}`,
      '/api/items/tags',
    ])
    expect(remote.items.get(item.id)?.title).toBe('直した題')
    expect(remote.items.get(item.id)?.tags).toEqual(['仕事'])
    expect(await listOperations()).toEqual([])
    expect((await allItems()).every((stored) => stored.syncState === 'synced')).toBe(true)
  })

  it('途中で通信が切れても、残りの操作は消えない', async () => {
    const first = itemDto()
    const second = itemDto()
    const remote = server([first, second])
    await mergeServerItems([first, second])

    await patchTodos([first.id], { status: 'closed' })
    await patchTodos([second.id], { status: 'closed' })

    // 1件目を送ったところで切れる
    let sent = 0
    const flaky = {
      ...remote,
      request: (async (path: string, options?: unknown) => {
        if (sent >= 1) throw networkError()
        sent += 1
        return remote.request(path, options as never)
      }) as typeof remote.request,
    }

    const result = await drainQueue({ request: flaky.request })

    expect(result).toEqual({ sent: 1, stoppedBy: 'retry' })
    expect(remote.items.get(first.id)?.status).toBe('closed')
    // 送れなかったほうは、ローカルの変更も操作も残っている
    const pending = await listOperations()
    expect(pending.length).toBe(1)
    expect(pending[0]?.itemIds).toEqual([second.id])
    expect((await getItem(second.id))?.status).toBe('closed')
    expect((await getItem(second.id))?.syncState).toBe('pending_update')
  })

  it('同じ操作が二度届いても二重登録にならない（冪等）', async () => {
    const remote = server()
    const draft = itemDto({ title: '一度だけ作られるタスク' })

    await createTodo(draft, '一度だけ作られるタスク')

    // 「サーバーでは成功したが、応答を受け取れなかった」状況を作る
    const lossy = (async (path: string, options?: unknown) => {
      await remote.request(path, options as never)
      throw networkError()
    }) as typeof remote.request

    const firstTry = await drainQueue({ request: lossy })
    expect(firstTry.sent).toBe(0)
    expect(remote.items.size).toBe(1)

    // 送り直す
    await sync(remote)

    expect(remote.items.size).toBe(1)
    expect(remote.calls.filter((call) => call.method === 'POST').length).toBe(2)
    expect((await getItem(draft.id))?.syncState).toBe('synced')
    expect(await listOperations()).toEqual([])
  })

  it('送ってしまった削除も、応答の控えから戻せる', async () => {
    const item = itemDto()
    const remote = server([item])
    await mergeServerItems([item])

    await removeTodos([item.id])
    await sync(remote)

    expect(remote.items.has(item.id)).toBe(false)
    expect(await getItem(item.id)).toBeUndefined()

    // 取り消し（`u`）
    await restoreTodos([item.id])
    expect((await getItem(item.id))?.syncState).toBe('pending_create')

    await sync(remote)

    expect(remote.items.has(item.id)).toBe(true)
    expect((await getItem(item.id))?.syncState).toBe('synced')
    expect(await listOperations()).toEqual([])
  })

  it('続けて行った操作の基準は、前の送信の結果に合わせて進む', async () => {
    const item = itemDto()
    const remote = server([item])
    await mergeServerItems([item])

    await patchTodos([item.id], { status: 'in_progress' })
    await patchTodos([item.id], { priority: 2 })

    const result = await sync(remote)

    // 2件とも通る（1件目で updatedAt が進んでも競合にしない）
    expect(result.sent).toBe(2)
    expect(await listConflicts()).toEqual([])
    expect(remote.items.get(item.id)).toMatchObject({
      status: 'in_progress',
      priority: 2,
    })
  })
})

describe('競合', () => {
  beforeEach(async () => {
    const { resetLocalDatabase } = await import('../helpers')
    await resetLocalDatabase()
  })

  it('他の端末の変更が先にあると、サーバー側を採り、捨てた内容を記録する', async () => {
    const item = itemDto({ title: 'もとの題' })
    const remote = server([item])
    await mergeServerItems([item])

    remote.down = true
    await patchTodos([item.id], { title: 'この端末で直した題' })
    remote.down = false

    // 別の端末が先に変えた
    remote.items.set(item.id, {
      ...item,
      title: '別の端末で直した題',
      updatedAt: stamp(),
    })

    await sync(remote)

    // サーバー側の内容になる
    const stored = await getItem(item.id)
    expect(stored?.title).toBe('別の端末で直した題')
    expect(stored?.syncState).toBe('synced')

    // 黙って捨てない
    const conflicts = await listConflicts()
    expect(conflicts.length).toBe(1)
    expect(conflicts[0]).toMatchObject({
      itemId: item.id,
      reason: 'server_newer',
      discarded: { title: 'この端末で直した題' },
    })
    expect(await listOperations()).toEqual([])
  })

  it('他の端末で削除されていたら、こちらでも消して知らせる', async () => {
    const item = itemDto()
    const remote = server([item])
    await mergeServerItems([item])

    remote.items.delete(item.id)

    await patchTodos([item.id], { status: 'closed' })
    await sync(remote)

    expect(await getItem(item.id)).toBeUndefined()
    expect((await listConflicts())[0]).toMatchObject({ reason: 'server_deleted' })
  })
})
