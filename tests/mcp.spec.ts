// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { appendText, createMcpServer, formatDue, toDuePatch, type ApiCall } from '~~/server/mcp/server'

interface Call {
  path: string
  method: string
  query?: Record<string, unknown>
  body?: unknown
}

/** 取り直しの時刻つきで返す API の応答（server/utils/fetched.ts）。 */
function fetched<T>(data: T) {
  return { fetchedAt: '2026-11-17T01:00:00.000Z', data }
}

/** API の代わり。呼ばれた内容を控え、パスごとの応答を返す。 */
function fakeApi(responses: Record<string, unknown>) {
  const calls: Call[] = []
  const api: ApiCall = async (path, options) => {
    const method = options?.method ?? 'GET'
    calls.push({ path, method, query: options?.query, body: options?.body })
    const key = `${method} ${path}`
    if (!(key in responses)) throw Object.assign(new Error('not stubbed'), { data: { message: `${key} は未定義` }, statusCode: 404 })
    return responses[key] as never
  }
  return { api, calls }
}

async function connect(api: ApiCall) {
  const server = createMcpServer(api, new Date('2026-11-17T10:00:00+09:00'))
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(b)
  return client
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { text: string }[])[0]!.text
}

describe('MCP サーバー', () => {
  it('ツールの一覧を返す', async () => {
    const client = await connect(fakeApi({}).api)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_work_log',
      'create_item',
      'get_diary',
      'get_item',
      'list_diaries',
      'list_items',
      'list_tags',
      'search',
      'set_item_tags',
      'update_item',
      'update_work_log',
      'write_diary',
    ])
  })

  it('今日の日付を instructions で伝える', async () => {
    const client = await connect(fakeApi({}).api)
    expect(client.getInstructions()).toContain('2026-11-17')
  })

  it('作業記録は、その日の記録があれば追記する', async () => {
    const { api, calls } = fakeApi({
      'GET /api/items/11111111-1111-4111-8111-111111111111': fetched({
        sections: [
          { id: 's1', date: '2026-11-16', body: '昨日' },
          { id: 's2', date: '2026-11-17', body: '朝の作業\n' },
        ],
      }),
      'PATCH /api/sections/s2': { id: 's2' },
    })
    const client = await connect(api)
    await client.callTool({
      name: 'add_work_log',
      arguments: { itemId: '11111111-1111-4111-8111-111111111111', body: '夜の作業' },
    })
    expect(calls.at(-1)).toEqual({
      path: '/api/sections/s2',
      method: 'PATCH',
      query: undefined,
      body: { body: '朝の作業\n夜の作業' },
    })
  })

  it('作業記録は、その日の記録が無ければ作る', async () => {
    const { api, calls } = fakeApi({
      'GET /api/items/11111111-1111-4111-8111-111111111111': fetched({ sections: [] }),
      'POST /api/sections': { id: 'new' },
    })
    const client = await connect(api)
    await client.callTool({
      name: 'add_work_log',
      arguments: { itemId: '11111111-1111-4111-8111-111111111111', body: 'メモ', date: '2026-11-10' },
    })
    expect(calls.at(-1)?.body).toEqual({
      itemId: '11111111-1111-4111-8111-111111111111',
      date: '2026-11-10',
      body: 'メモ',
    })
  })

  it('日記は既定で書き足す', async () => {
    const { api, calls } = fakeApi({
      'GET /api/diaries/2026-11-17': fetched({ body: '朝' }),
      'PUT /api/diaries/2026-11-17': { date: '2026-11-17', body: '朝\n夜' },
    })
    const client = await connect(api)
    await client.callTool({ name: 'write_diary', arguments: { body: '夜' } })
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { body: '朝\n夜' } })
  })

  it('日記を replace で置き換える', async () => {
    const { api, calls } = fakeApi({ 'PUT /api/diaries/2026-11-01': {} })
    const client = await connect(api)
    await client.callTool({ name: 'write_diary', arguments: { body: '全部', date: '2026-11-01', mode: 'replace' } })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.body).toEqual({ body: '全部' })
  })

  it('期限を日本時間で API へ渡す', async () => {
    const id = '22222222-2222-4222-8222-222222222222'
    const { api, calls } = fakeApi({ [`PATCH /api/items/${id}`]: { id, tags: [], body: null, recurrenceRule: null } })
    const client = await connect(api)
    await client.callTool({ name: 'update_item', arguments: { id, due: '2026-12-01', status: 'in_progress' } })
    expect(calls[0]!.body).toEqual({
      status: 'in_progress',
      dueAt: '2026-12-01T23:59:00+09:00',
      dueHasTime: false,
    })
  })

  it('API のエラーをツールのエラーとして返す', async () => {
    const client = await connect(fakeApi({}).api)
    const result = await client.callTool({ name: 'list_tags', arguments: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('GET /api/tags は未定義')
  })

  it('一覧は件数を絞り、本文を縮める', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: String(i),
      title: `t${i}`,
      body: 'x'.repeat(500),
      tags: [],
      recurrenceRule: null,
    }))
    const client = await connect(fakeApi({ 'GET /api/items': fetched(items) }).api)
    const result = await client.callTool({ name: 'list_items', arguments: { open: true } })
    const parsed = JSON.parse(textOf(result))
    expect(parsed.total).toBe(60)
    expect(parsed.items).toHaveLength(50)
    expect(parsed.items[0].excerpt).toHaveLength(200)
  })
})

describe('toDuePatch', () => {
  it('時刻つき', () => {
    expect(toDuePatch('2026-12-01T09:30')).toEqual({ dueAt: '2026-12-01T09:30:00+09:00', dueHasTime: true })
  })
  it('null で外す', () => {
    expect(toDuePatch(null)).toEqual({ dueAt: null, dueHasTime: false })
  })
  it('不正な形式は弾く', () => {
    expect(() => toDuePatch('明日')).toThrow()
  })
})

describe('appendText', () => {
  it('空なら そのまま', () => {
    expect(appendText('  \n', 'a')).toBe('a')
  })
})

describe('formatDue', () => {
  it('日付だけの期限は日本時間の日付で返す', () => {
    expect(formatDue('2026-12-01T14:59:00.000Z', false)).toBe('2026-12-01')
  })
  it('時刻つきは日本時間で返す', () => {
    expect(formatDue('2026-12-01T00:30:00.000Z', true)).toBe('2026-12-01 09:30')
  })
})
