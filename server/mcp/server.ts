import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ITEM_STATUSES, type ItemDetailDto, type ItemDto } from '../../shared/types/item'
import type { DiaryDetailDto, DiaryDto, DiarySummaryDto } from '../../shared/types/diary'
import type { Fetched } from '../../shared/types/fetched'
import type { SearchHit } from '../../shared/types/search'
import { APP_TIME_ZONE, toAppDate } from '../../shared/utils/date'

/**
 * Claude から読み書きするための MCP サーバー（docs/18-mcp.md）。
 *
 * 中身は既存の API（`/api/...`）を呼ぶだけにする。検証・冪等性・
 * 完了時の繰り返し生成などは API 側にあり、ここで二重に持つと
 * 画面から操作したときと結果がずれるため。
 */

/** API を呼ぶ関数。本番では Nitro の `$fetch`（HTTP を介さない内部呼び出し）を渡す。 */
export type ApiCall = <T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; query?: Record<string, unknown>; body?: unknown },
) => Promise<T>

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('日付（YYYY-MM-DD、日本時間）')

/** 一覧で返す件数の既定値。全件を返すと会話の文脈を食いつぶすため。 */
const DEFAULT_LIST_LIMIT = 50

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/** API のエラーを、Claude が読んで直せる形で返す。 */
function failure(error: unknown): CallToolResult {
  const e = error as { data?: { message?: string }; message?: string; statusCode?: number }
  const message = e?.data?.message ?? e?.message ?? String(error)
  const status = e?.statusCode ? ` (HTTP ${e.statusCode})` : ''
  return { isError: true, content: [{ type: 'text', text: `${message}${status}` }] }
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return json(await fn())
  } catch (error) {
    return failure(error)
  }
}

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * 期限を日本時間で読める形にする（`YYYY-MM-DD` / `YYYY-MM-DD HH:mm`）。
 *
 * API の dueAt は UTC の ISO 8601 で、日付だけの期限（23:59 JST）は
 * UTC では14:59になる。そのまま渡すと日付を読み違えやすい。
 */
export function formatDue(dueAt: string | null, hasTime: boolean): string | null {
  if (!dueAt) return null
  const at = new Date(dueAt)
  return hasTime ? `${toAppDate(at)} ${timeFormatter.format(at)}` : toAppDate(at)
}

/** 一覧向けに Item を縮める。本文は先頭だけにする。 */
function brief(item: ItemDto) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    due: formatDue(item.dueAt, item.dueHasTime),
    tags: item.tags,
    url: item.url,
    recurring: item.recurrenceRule !== null,
    excerpt: item.body ? item.body.slice(0, 200) : null,
  }
}

/**
 * 期限の入力（日本時間）を API が受け取る ISO 8601 にする。
 *
 * 日付だけなら、画面から付けた期限と同じく当日の 23:59 にする
 * （docs/02-data-model.md の due_has_time）。
 */
export function toDuePatch(due: string | null): { dueAt: string | null; dueHasTime: boolean } {
  if (due === null) return { dueAt: null, dueHasTime: false }
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?$/.exec(due)
  if (!m) throw new Error('期限は YYYY-MM-DD または YYYY-MM-DDTHH:mm で指定してください')
  return m[2]
    ? { dueAt: `${m[1]}T${m[2]}:00+09:00`, dueHasTime: true }
    : { dueAt: `${m[1]}T23:59:00+09:00`, dueHasTime: false }
}

/** 既存の本文の後ろに書き足す。間は1行空けず、改行1つでつなぐ。 */
export function appendText(current: string, addition: string): string {
  if (!current.trim()) return addition
  return `${current.replace(/\s+$/, '')}\n${addition}`
}

export function createMcpServer(api: ApiCall, now: Date = new Date()): McpServer {
  const today = toAppDate(now)

  const server = new McpServer(
    { name: 'life-record', version: '1.0.0' },
    {
      instructions: [
        '個人用の記録サービス（タスク・作業記録・日記）です。',
        `今日の日付は ${today}（日本時間）です。日付はすべて日本時間の YYYY-MM-DD で扱います。`,
        '- Item: タスク。status は backlog（未着手）/ in_progress（作業中）/ closed（完了）。',
        '- 作業記録（Section）: Item に対する、ある日の作業メモ。1つの Item につき1日1件にまとめる。',
        '- 日記（Diary）: 1日1ページ。',
        '本文は Scrapbox 記法のプレーンテキスト（行頭のスペースで箇条書き、[リンク]、`code` など）。',
        '日記や作業記録を書き換えるときは、利用者が書いた内容を消さないよう、原則 append を使ってください。',
      ].join('\n'),
    },
  )

  server.registerTool(
    'search',
    {
      title: '横断検索',
      description: 'タスクのタイトル・作業記録・日記の本文を部分一致で検索する。新しい順に最大100件。',
      inputSchema: {
        q: z.string().min(1).describe('検索語'),
        kind: z.enum(['all', 'item', 'section', 'diary']).optional().describe('対象の種別。既定は all'),
        status: z.enum(ITEM_STATUSES).optional(),
        tag: z.string().optional().describe('タグ名で絞る（日記は対象外になる）'),
        from: DATE.optional(),
        to: DATE.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => api<SearchHit[]>('/api/search', { query: args })),
  )

  server.registerTool(
    'list_items',
    {
      title: 'タスク一覧',
      description:
        'タスクの一覧を、重要度順→期限順で返す。本文は先頭200文字だけ。詳細は get_item で取る。',
      inputSchema: {
        status: z.enum([...ITEM_STATUSES, 'all']).optional().describe('既定は all'),
        open: z.boolean().optional().describe('true なら未完了だけ'),
        dueToday: z.boolean().optional().describe('true なら期限が今日まで（期限切れを含む）のものだけ'),
        tag: z.string().optional(),
        untagged: z.boolean().optional().describe('true ならタグの無いものだけ'),
        limit: z.number().int().min(1).max(500).optional().describe(`既定は ${DEFAULT_LIST_LIMIT}`),
      },
      annotations: { readOnlyHint: true },
    },
    ({ status, open, dueToday, tag, untagged, limit }) =>
      run(async () => {
        const { data: items } = await api<Fetched<ItemDto[]>>('/api/items', {
          query: {
            status,
            open: open ? 'true' : undefined,
            dueUntil: dueToday ? 'today' : undefined,
            tag,
            untagged: untagged ? 'true' : undefined,
          },
        })
        const max = limit ?? DEFAULT_LIST_LIMIT
        return { total: items.length, items: items.slice(0, max).map(brief) }
      }),
  )

  server.registerTool(
    'get_item',
    {
      title: 'タスクの詳細',
      description: 'タスク1件の詳細と、すべての作業記録（日付の古い順）を返す。',
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) =>
      run(async () => {
        const { data } = await api<Fetched<ItemDetailDto>>(`/api/items/${id}`)
        const { dueAt, dueHasTime, ...item } = data
        return { ...item, due: formatDue(dueAt, dueHasTime) }
      }),
  )

  server.registerTool(
    'create_item',
    {
      title: 'タスクを追加',
      description: [
        'タスクを追加する。1行目がタイトルで、SmartAdd の記法が使える:',
        '`#タグ`、`!1`〜`!3`（重要度、1が高）、`^明日` `^2026-12-01` `^金曜 15:00`（期限）、',
        '`^なし`（期限なし）、`*毎週`（繰り返し）、URL。期限を書かなければ今日になる。',
        '2行目以降は、その日の作業記録（本文）になる。',
      ].join(''),
      inputSchema: {
        text: z.string().min(1),
        status: z.enum(ITEM_STATUSES).optional().describe('既定は backlog'),
      },
    },
    ({ text, status }) =>
      run(async () => brief(await api<ItemDto>('/api/items', { method: 'POST', body: { text, status } }))),
  )

  server.registerTool(
    'update_item',
    {
      title: 'タスクを更新',
      description:
        '指定した項目だけを変更する。closed にすると完了扱いになり、繰り返しタスクなら次の回が作られる。',
      inputSchema: {
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        status: z.enum(ITEM_STATUSES).optional(),
        priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]).optional().describe('1(高)〜3(低)。null で外す'),
        url: z.string().nullable().optional().describe('null で外す'),
        due: z
          .string()
          .nullable()
          .optional()
          .describe('期限。YYYY-MM-DD（日付のみ）または YYYY-MM-DDTHH:mm（日本時間）。null で外す'),
      },
      annotations: { idempotentHint: true },
    },
    ({ id, due, ...rest }) =>
      run(async () => {
        const body: Record<string, unknown> = Object.fromEntries(
          Object.entries(rest).filter(([, v]) => v !== undefined),
        )
        if (due !== undefined) Object.assign(body, toDuePatch(due))
        return brief(await api<ItemDto>(`/api/items/${id}`, { method: 'PATCH', body }))
      }),
  )

  server.registerTool(
    'set_item_tags',
    {
      title: 'タグの付け外し',
      description: 'タスクにタグを付ける / 外す。無いタグは作られる。',
      inputSchema: {
        ids: z.array(z.string().uuid()).min(1),
        add: z.array(z.string()).optional(),
        remove: z.array(z.string()).optional(),
      },
      annotations: { idempotentHint: true },
    },
    ({ ids, add, remove }) =>
      run(() => api('/api/items/tags', { method: 'POST', body: { ids, add, remove } })),
  )

  server.registerTool(
    'list_tags',
    {
      title: 'タグ一覧',
      description: 'タグの一覧（タスクの件数つき）。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run(() => api('/api/tags')),
  )

  server.registerTool(
    'add_work_log',
    {
      title: '作業記録を書き足す',
      description:
        'タスクのその日の作業記録に書き足す。その日の記録がすでにあれば末尾に追記し、無ければ作る（1日1件にまとめる）。',
      inputSchema: {
        itemId: z.string().uuid(),
        body: z.string().min(1).describe('書き足す本文（Scrapbox 記法）'),
        date: DATE.optional().describe('既定は今日'),
      },
    },
    ({ itemId, body, date }) =>
      run(async () => {
        const day = date ?? today
        const { data: item } = await api<Fetched<ItemDetailDto>>(`/api/items/${itemId}`)
        // 同じ日に複数あるときは最後の1件が当日の枠（docs/03-functional-spec.md 3.2）
        const existing = item.sections.filter((s) => s.date === day).at(-1)
        if (existing) {
          return await api(`/api/sections/${existing.id}`, {
            method: 'PATCH',
            body: { body: appendText(existing.body, body) },
          })
        }
        return await api('/api/sections', { method: 'POST', body: { itemId, date: day, body } })
      }),
  )

  server.registerTool(
    'update_work_log',
    {
      title: '作業記録を書き換える',
      description:
        '作業記録1件の本文または日付を置き換える。本文は丸ごと置き換わるので、先に get_item で今の本文を読むこと。',
      inputSchema: {
        id: z.string().uuid().describe('作業記録（Section）の id'),
        body: z.string().optional(),
        date: DATE.optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ id, body, date }) => run(() => api(`/api/sections/${id}`, { method: 'PATCH', body: { body, date } })),
  )

  server.registerTool(
    'get_diary',
    {
      title: '日記を読む',
      description: 'その日の日記と、その日に作業したタスク・作業記録を返す。',
      inputSchema: { date: DATE.optional().describe('既定は今日') },
      annotations: { readOnlyHint: true },
    },
    ({ date }) =>
      run(async () => {
        const { data } = await api<Fetched<DiaryDetailDto>>(`/api/diaries/${date ?? today}`)
        return data
      }),
  )

  server.registerTool(
    'list_diaries',
    {
      title: '日記の一覧',
      description: '日記の一覧（日付の新しい順、本文は抜粋）。',
      inputSchema: {
        from: DATE.optional(),
        to: DATE.optional(),
        limit: z.number().int().min(1).max(200).optional().describe('既定は30（期間指定時は200）'),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => api<DiarySummaryDto[]>('/api/diaries', { query: args })),
  )

  server.registerTool(
    'write_diary',
    {
      title: '日記を書く',
      description:
        'その日の日記に書く。mode=append（既定）は末尾に書き足す。mode=replace は全体を置き換える（空にすると日記が消える）。',
      inputSchema: {
        body: z.string(),
        date: DATE.optional().describe('既定は今日'),
        mode: z.enum(['append', 'replace']).optional(),
      },
      annotations: { destructiveHint: true },
    },
    ({ body, date, mode }) =>
      run(async () => {
        const day = date ?? today
        let next = body
        if ((mode ?? 'append') === 'append') {
          const { data: current } = await api<Fetched<DiaryDetailDto>>(`/api/diaries/${day}`)
          next = appendText(current.body, body)
        }
        return await api<DiaryDto>(`/api/diaries/${day}`, { method: 'PUT', body: { body: next } })
      }),
  )

  return server
}
