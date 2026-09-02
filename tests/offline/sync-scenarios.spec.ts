import { beforeEach, describe, expect, it } from 'vitest'
import type { ItemDto } from '~~/shared/types/item'
import {
  allItems,
  getItem,
  listConflicts,
  mergeServerItems,
  putItem,
} from '~/utils/offline/todo-repository'
import {
  applyTodoTags,
  createTodo,
  patchTodos,
  removeTodos,
  restoreTodos,
} from '~/utils/offline/todo-actions'
import { listOperations } from '~/utils/offline/sync-queue'
import { drainQueue } from '~/utils/offline/sync-engine'
import {
  FRESH_FETCH,
  fakeServer,
  httpError,
  itemDto,
  networkError,
  type RecordedRequest,
} from '../helpers'

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
  /**
   * 受け取って書き換えるが、応答は返さない状態。
   *
   * 「1回目は届いていたのに、応答だけが返らなかった」の再現に使う
   * （送り直すと、サーバーの updatedAt が進んでいるので競合に見える）。
   */
  swallow: boolean
}

function server(seed: ItemDto[] = []): Server {
  const items = new Map(seed.map((item) => [item.id, item]))
  const state = { down: false, swallow: false }

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
      // 書き換えは済んでいるが、応答が返らない
      if (state.swallow) throw networkError()
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
    get swallow() {
      return state.swallow
    },
    set swallow(value: boolean) {
      state.swallow = value
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
    await mergeServerItems([item], FRESH_FETCH)

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
    await mergeServerItems([existing], FRESH_FETCH)

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

  it('メモを直してから消し、取り消しても、その変更は未同期のまま残る', async () => {
    const item = itemDto({ note: 'もとのメモ' })
    const remote = server([item])
    await mergeServerItems([item], FRESH_FETCH)
    remote.down = true

    await patchTodos([item.id], { note: '直したメモ' })
    await removeTodos([item.id])
    await restoreTodos([item.id])

    /*
     * 削除は送らずに取り消せたが、メモの変更はまだ列に残っている。
     * ここで同期済みに戻すと、次の取り直しでサーバーの内容に上書きされる
     */
    const stored = await getItem(item.id)
    expect(stored?.note).toBe('直したメモ')
    expect(stored?.syncState).toBe('pending_update')

    await mergeServerItems([item], FRESH_FETCH)
    expect((await getItem(item.id))?.note).toBe('直したメモ')
  })

  it('オフラインで消したものを、送る前なら取り消せる', async () => {
    const item = itemDto()
    const remote = server([item])
    await mergeServerItems([item], FRESH_FETCH)
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
    await mergeServerItems([item], FRESH_FETCH)

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
    await mergeServerItems([first, second], FRESH_FETCH)

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
    await mergeServerItems([item], FRESH_FETCH)

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
    await mergeServerItems([item], FRESH_FETCH)

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

/**
 * 取得（GET）と保存（PATCH）は別々に飛ぶので、**保存より前に出した取得の応答が
 * 保存の後で届く**ことがある（docs/15-client-state.md 14.2 の 4）。その応答を
 * そのまま当てると、直した題やメモが入力したそばから巻き戻って見える。
 */
/**
 * 送り直しで、自分の変更を自分で捨てないこと（docs/12-offline.md 12.5）。
 *
 * 応答が返らなかった送信は列に残って送り直される。1回目が実は届いていると、
 * サーバーの updatedAt は進んでいるので**競合に見える**。そこでサーバー側を
 * 採ると、続けて書いた分までまとめて取り下げられ、メモや題が巻き戻る。
 */
describe('届いていた送信の送り直し', () => {
  beforeEach(async () => {
    const { resetLocalDatabase } = await import('../helpers')
    await resetLocalDatabase()
  })

  it('同じ内容がすでに入っていれば、競合として扱わない', async () => {
    const item = itemDto({ note: 'もとのメモ', updatedAt: stamp() })
    const remote = server([item])
    await mergeServerItems([item], FRESH_FETCH)

    // メモを直して送る。サーバーには届くが、応答が返らない
    remote.swallow = true
    await patchTodos([item.id], { note: '直したメモ' })
    await sync(remote)
    expect(remote.items.get(item.id)?.note).toBe('直したメモ')
    expect((await listOperations()).length).toBe(1)

    // 応答を待つ間に書き足した分
    await patchTodos([item.id], { note: '直したメモ（続き）' })

    // 通信が戻る。1件目は送り直しになり、サーバーからは 409 が返る
    remote.swallow = false
    await sync(remote)

    expect(await listConflicts()).toEqual([])
    expect((await getItem(item.id))?.note).toBe('直したメモ（続き）')
    expect((await getItem(item.id))?.syncState).toBe('synced')
    expect(remote.items.get(item.id)?.note).toBe('直したメモ（続き）')
    expect(await listOperations()).toEqual([])
  })

  it('違う内容が入っていれば、新しい方を採る（ここではサーバー）', async () => {
    const item = itemDto({ note: 'もとのメモ', updatedAt: stamp() })
    const remote = server([item])
    await mergeServerItems([item], FRESH_FETCH)

    // この端末で直したのは、他の端末の変更より前
    await patchTodos(
      [item.id],
      { note: '直したメモ' },
      new Date('2026-08-17T00:00:00.000Z'),
    )
    // 他の端末が、その後に直した（こちらは知らない）
    remote.items.set(item.id, { ...item, note: '別の端末のメモ', updatedAt: stamp() })

    await sync(remote)

    expect((await listConflicts()).length).toBe(1)
    expect((await getItem(item.id))?.note).toBe('別の端末のメモ')
  })
})

/**
 * 応答は**送った時点の姿**なので、そのまま当てると、送っている間に書いた分が
 * 消える。ローカルへ書くことと列へ積むことは別々の取引で、書き終わっていても
 * 列にはまだ入っていない瞬間があるため、列だけを見ていては気づけない。
 */
describe('送信の往復中に書き足したとき', () => {
  beforeEach(async () => {
    const { resetLocalDatabase } = await import('../helpers')
    await resetLocalDatabase()
  })

  it('手元が先へ進んでいたら、応答で塗り潰さない', async () => {
    const item = itemDto({ note: 'もとのメモ', updatedAt: stamp() })
    const remote = server([item])
    await mergeServerItems([item], FRESH_FETCH)

    await patchTodos([item.id], { note: '直したメモ' })

    // 応答が返る直前に書き足す。ローカルへは書けたが、列へはまだ積まれていない
    const typing = (async (path: string, options?: unknown) => {
      const response = await remote.request(path, options as never)
      const local = await getItem(item.id)
      if (local) {
        await putItem({
          ...local,
          note: '書き足したメモ',
          updatedAt: new Date().toISOString(),
          syncState: 'pending_update',
        })
      }
      return response
    }) as typeof remote.request

    await drainQueue({ request: typing })

    // 書き足した分は残り、未同期のまま（続けて送られる）
    const stored = await getItem(item.id)
    expect(stored?.note).toBe('書き足したメモ')
    expect(stored?.syncState).toBe('pending_update')
    // 競合の基準は、送り終えた時点のサーバーに合わせて進む
    expect(stored?.baseUpdatedAt).toBe(remote.items.get(item.id)?.updatedAt)
    expect(await listConflicts()).toEqual([])
  })

  it('手元が送った内容のままなら、送り終えた印を付ける', async () => {
    const item = itemDto({ note: 'もとのメモ', updatedAt: stamp() })
    const remote = server([item])
    await mergeServerItems([item], FRESH_FETCH)

    await patchTodos([item.id], { note: '直したメモ' })
    await sync(remote)

    const stored = await getItem(item.id)
    expect(stored?.note).toBe('直したメモ')
    expect(stored?.syncState).toBe('synced')
  })
})

describe('取り直しと保存が前後したとき', () => {
  beforeEach(async () => {
    const { resetLocalDatabase } = await import('../helpers')
    await resetLocalDatabase()
  })

  it('取りに行った後に送り終えた分は、その応答で戻さない', async () => {
    const item = itemDto({ note: 'もとのメモ', updatedAt: stamp() })
    const remote = server([item])

    // 取りに行った時点の写しと、その応答を作った時刻
    const snapshot = [{ ...item }]
    const fetchedAt = stamp()
    await mergeServerItems(snapshot, fetchedAt)

    // メモを直して送る。サーバーはここで新しい updatedAt を打つ
    await patchTodos([item.id], { note: '直したメモ' })
    await sync(remote)
    expect((await getItem(item.id))?.syncState).toBe('synced')

    // 取りに行った応答が、送り終えた後になって届く
    await mergeServerItems(snapshot, fetchedAt)

    const stored = await getItem(item.id)
    expect(stored?.note).toBe('直したメモ')
    expect(stored?.syncState).toBe('synced')
  })
})

describe('競合', () => {
  beforeEach(async () => {
    const { resetLocalDatabase } = await import('../helpers')
    await resetLocalDatabase()
  })

  it('手元の変更のほうが新しければ、サーバーの版に載せ直して送り直す', async () => {
    const item = itemDto({ title: 'もとの題', note: 'もとのメモ', updatedAt: stamp() })
    const remote = server([item])
    await mergeServerItems([item], FRESH_FETCH)

    remote.down = true
    await patchTodos([item.id], { note: 'この端末のメモ' })
    remote.down = false

    // 別の端末が、こちらより前に**別の項目**を変えていた
    remote.items.set(item.id, {
      ...item,
      title: '別の端末で直した題',
      updatedAt: stamp(),
    })

    // 1回目は競合。基準をサーバーに合わせて送り直す
    await sync(remote)
    await sync(remote)

    // 自分が変えた項目は残り、相手が変えた項目もそのまま
    expect(remote.items.get(item.id)?.note).toBe('この端末のメモ')
    expect(remote.items.get(item.id)?.title).toBe('別の端末で直した題')
    expect((await getItem(item.id))?.note).toBe('この端末のメモ')

    // 捨てていないので、知らせも出さない
    expect(await listConflicts()).toEqual([])
    expect(await listOperations()).toEqual([])
  })

  it('サーバーの変更のほうが新しければ、サーバー側を採り、捨てた内容を記録する', async () => {
    const item = itemDto({ title: 'もとの題' })
    const remote = server([item])
    await mergeServerItems([item], FRESH_FETCH)

    remote.down = true
    // この端末で直したのは、他の端末の変更より前
    await patchTodos(
      [item.id],
      { title: 'この端末で直した題' },
      new Date('2026-08-17T00:00:00.000Z'),
    )
    remote.down = false

    // 別の端末が、その後に変えた
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
    await mergeServerItems([item], FRESH_FETCH)

    remote.items.delete(item.id)

    await patchTodos([item.id], { status: 'closed' })
    await sync(remote)

    expect(await getItem(item.id)).toBeUndefined()
    expect((await listConflicts())[0]).toMatchObject({ reason: 'server_deleted' })
  })
})
