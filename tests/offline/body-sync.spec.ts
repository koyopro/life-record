import { beforeEach, describe, expect, it } from 'vitest'
import type { SectionDto } from '~~/shared/types/item'
import {
  removeSectionLocally,
  reorderSectionsLocally,
  resumePendingBodies,
  saveDiaryBody,
  saveSectionBody,
} from '~/utils/offline/body-actions'
import {
  getDiary,
  getSection,
  putSection,
  sectionsOfItem,
  toLocalSection,
} from '~/utils/offline/body-repository'
import { listOperations } from '~/utils/offline/sync-queue'
import { drainQueue } from '~/utils/offline/sync-engine'
import { putItem } from '~/utils/offline/todo-repository'
import {
  fakeServer,
  itemDto,
  networkError,
  resetLocalDatabase,
  type RecordedRequest,
} from '../helpers'

/**
 * オフラインで書いた本文（作業記録・日記）が、繋がったときに送られる筋道
 * （docs/12-offline.md 12.4 / 12.7）。
 *
 * サーバーの代わりに、upsert するだけの簡単な実装を置いて確かめる。
 */

const ITEM_ID = '00000000-0000-4000-8000-0000000000aa'
const SECTION_ID = '00000000-0000-4000-8000-000000000001'
const DATE = '2026-08-22'

interface Server {
  request: ReturnType<typeof fakeServer>['request']
  calls: RecordedRequest[]
  sections: Map<string, SectionDto>
  diaries: Map<string, string>
  /** 落ちている状態。オフラインの再現に使う。 */
  down: boolean
}

function server(): Server {
  const state: Server = {
    request: async () => null,
    calls: [],
    sections: new Map(),
    diaries: new Map(),
    down: false,
  }

  let clock = 0
  function stamp(): string {
    clock += 1
    return new Date(Date.UTC(2026, 7, 22, 12, 0, clock)).toISOString()
  }

  const fake = fakeServer((path, options) => {
    if (state.down) throw networkError()

    const method = options?.method ?? 'GET'
    const body = options?.body as Record<string, string> | undefined

    if (path.startsWith('/api/sections/') && method === 'PUT') {
      const id = path.replace('/api/sections/', '')
      const current = state.sections.get(id)
      const saved: SectionDto = {
        id,
        date: body!.date!,
        body: body!.body!,
        position: current?.position ?? 0,
        createdAt: current?.createdAt ?? stamp(),
        updatedAt: stamp(),
      }
      state.sections.set(id, saved)
      return saved
    }

    if (path.startsWith('/api/sections/') && method === 'DELETE') {
      state.sections.delete(path.replace('/api/sections/', ''))
      return null
    }

    if (path === '/api/sections/reorder' && method === 'POST') {
      const ids = body!.ids as unknown as string[]
      return ids.map((id, position) => {
        const saved = { ...state.sections.get(id)!, position, updatedAt: stamp() }
        state.sections.set(id, saved)
        return saved
      })
    }

    if (path.startsWith('/api/diaries/') && method === 'PUT') {
      const date = path.replace('/api/diaries/', '')
      state.diaries.set(date, body!.body!)
      return { date, body: body!.body!, updatedAt: stamp() }
    }

    throw new Error(`知らない呼び出し: ${method} ${path}`)
  })

  state.request = fake.request
  state.calls = fake.calls
  return state
}

describe('本文の同期', () => {
  beforeEach(async () => {
    await resetLocalDatabase()
    await putItem({ ...itemDto({ id: ITEM_ID }), syncState: 'synced', baseUpdatedAt: null })
  })

  it('打鍵を重ねても、列に積まれる操作は1つだけ', async () => {
    await saveSectionBody({ id: SECTION_ID, itemId: ITEM_ID, date: DATE, body: 'あ' })
    await saveSectionBody({ id: SECTION_ID, itemId: ITEM_ID, date: DATE, body: 'あい' })
    await saveSectionBody({ id: SECTION_ID, itemId: ITEM_ID, date: DATE, body: 'あいう' })

    const operations = await listOperations()
    expect(operations).toHaveLength(1)
    expect((await getSection(SECTION_ID))?.body).toBe('あいう')
    expect((await getSection(SECTION_ID))?.syncState).toBe('pending_save')
  })

  it('オフラインで書いた本文を、繋がってから送る', async () => {
    const remote = server()
    remote.down = true

    await saveSectionBody({ id: SECTION_ID, itemId: ITEM_ID, date: DATE, body: 'オフラインで書いた' })
    await drainQueue({ request: remote.request })

    // 送れないので残る。手元には入っている
    expect(await listOperations()).toHaveLength(1)
    expect((await getSection(SECTION_ID))?.body).toBe('オフラインで書いた')

    remote.down = false
    // 送り直しの間隔を待たずに流す
    await drainQueue({ request: remote.request, now: () => new Date(Date.now() + 60_000) })

    expect(remote.sections.get(SECTION_ID)?.body).toBe('オフラインで書いた')
    expect(await listOperations()).toHaveLength(0)
    expect((await getSection(SECTION_ID))?.syncState).toBe('synced')
  })

  it('送るのは、そのときの手元の内容（積んだ時点の内容ではない）', async () => {
    const remote = server()
    await saveSectionBody({ id: SECTION_ID, itemId: ITEM_ID, date: DATE, body: '書きかけ' })
    await saveSectionBody({ id: SECTION_ID, itemId: ITEM_ID, date: DATE, body: '書き終わり' })

    await drainQueue({ request: remote.request })

    expect(remote.sections.get(SECTION_ID)?.body).toBe('書き終わり')
    expect(remote.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
  })

  it('作業記録を消すと、送ったあとローカルからも消える', async () => {
    const remote = server()
    await saveSectionBody({ id: SECTION_ID, itemId: ITEM_ID, date: DATE, body: '消す記録' })
    await drainQueue({ request: remote.request })

    await removeSectionLocally(SECTION_ID, ITEM_ID)
    // 送るまでは残す（取り消せるように）
    expect((await getSection(SECTION_ID))?.syncState).toBe('pending_delete')

    await drainQueue({ request: remote.request })

    expect(await getSection(SECTION_ID)).toBeUndefined()
    expect(remote.sections.has(SECTION_ID)).toBe(false)
  })

  it('並べ替えは、まとめて送って並び順を確定させる', async () => {
    const remote = server()
    const first = '00000000-0000-4000-8000-000000000011'
    const second = '00000000-0000-4000-8000-000000000012'
    await saveSectionBody({ id: first, itemId: ITEM_ID, date: DATE, body: '1件目' })
    await saveSectionBody({ id: second, itemId: ITEM_ID, date: DATE, body: '2件目' })
    await drainQueue({ request: remote.request })

    await reorderSectionsLocally(ITEM_ID, [second, first])
    await drainQueue({ request: remote.request })

    const stored = await sectionsOfItem(ITEM_ID)
    expect(stored.find((section) => section.id === second)?.position).toBe(0)
    expect(stored.find((section) => section.id === first)?.position).toBe(1)
    expect(stored.every((section) => section.syncState === 'synced')).toBe(true)
  })

  it('日記もオフラインで書けて、繋がってから送られる', async () => {
    const remote = server()
    remote.down = true

    await saveDiaryBody(DATE, '今日のこと')
    await drainQueue({ request: remote.request })
    expect((await getDiary(DATE))?.body).toBe('今日のこと')

    remote.down = false
    await drainQueue({ request: remote.request, now: () => new Date(Date.now() + 60_000) })

    expect(remote.diaries.get(DATE)).toBe('今日のこと')
    expect((await getDiary(DATE))?.syncState).toBe('synced')
    expect((await getDiary(DATE))?.updatedAt).not.toBeNull()
  })

  /**
   * ピン留め（3.3）より前に書いた写しは、`pinned` を持っていない。送るときは
   * 「立っていない」として false を添えるので、**送り終えた内容と手元の内容を
   * 素のまま比べると永久に食い違う**。食い違いは「往復中に書き足された」印
   * なので、そのまま積み直され、列が空にならないまま送り続けてしまう
   * （画面は「未同期」と「同期中」のまま動かない）。
   */
  it('ピンの印を持たない古い写しでも、送り終えたら同期済みになる', async () => {
    const remote = server()

    // この機能より前に書いた写し（pinned が無い）
    await putSection({
      id: SECTION_ID,
      itemId: ITEM_ID,
      date: DATE,
      body: '前に書いた分',
      position: 0,
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
      syncState: 'pending_save',
    } as unknown as Parameters<typeof putSection>[0])
    await saveSectionBody({
      id: SECTION_ID,
      itemId: ITEM_ID,
      date: DATE,
      body: '前に書いた分と続き',
    })

    // 回り続けても終わらないので、送信そのものに上限を置いて確かめる
    const capped = (async (path: string, options?: unknown) => {
      if (remote.calls.length >= 5) throw new Error('送り続けている（回り続けている）')
      return await remote.request(path, options as never)
    }) as typeof remote.request

    await drainQueue({ request: capped })

    expect(remote.calls).toHaveLength(1)
    expect(await listOperations()).toEqual([])
    const stored = await getSection(SECTION_ID)
    expect(stored?.syncState).toBe('synced')
    expect(stored?.body).toBe('前に書いた分と続き')
    expect(stored?.pinned).toBe(false)
  })

  it('列から操作が失われても、手元に残った本文は積み直される', async () => {
    await putSection(
      toLocalSection(
        ITEM_ID,
        {
          id: SECTION_ID,
          date: DATE,
          body: '送れていない本文',
          position: 0,
          createdAt: '2026-08-22T09:00:00.000Z',
          updatedAt: '2026-08-22T09:00:00.000Z',
        },
        'pending_save',
      ),
    )

    await resumePendingBodies()

    const operations = await listOperations()
    expect(operations).toHaveLength(1)
    expect(operations[0]?.kind).toBe('section_save')
  })
})
