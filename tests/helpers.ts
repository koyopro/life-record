import type { ItemDto } from '~~/shared/types/item'
import { deleteLocalDatabase } from '~/utils/offline/local-database'
import type { RequestFn, RequestOptions } from '~/utils/offline/sync-runner'

/** テストごとにローカルの保管庫を作り直す。 */
export async function resetLocalDatabase(): Promise<void> {
  await deleteLocalDatabase()
}

let counter = 0

/** 素の Item。必要なところだけ上書きして使う。 */
/**
 * 取りたての応答が持つ時刻（`Fetched.fetchedAt`）。
 *
 * 重ね方の新旧を試すのが目的でないテストで使う。手元のどれよりも新しいので、
 * 応答の内容がそのまま当たる。
 */
export const FRESH_FETCH = '2099-12-31T23:59:59.000Z'

export function itemDto(overrides: Partial<ItemDto> = {}): ItemDto {
  counter += 1
  const now = '2026-08-18T00:00:00.000Z'
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    title: `タスク${counter}`,
    status: 'backlog',
    priority: null,
    url: null,
    note: null,
    dueAt: null,
    dueHasTime: false,
    body: null,
    tags: [],
    recurrenceRule: null,
    recurrenceBasis: null,
    seriesId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export interface RecordedRequest {
  path: string
  method: string
  body: unknown
}

export interface FakeServer {
  request: RequestFn
  calls: RecordedRequest[]
}

/** 送信の代わり。呼ばれた内容を記録し、渡した応答を返す。 */
export function fakeServer(
  handler: (path: string, options: RequestOptions | undefined) => unknown,
): FakeServer {
  const calls: RecordedRequest[] = []

  const request: RequestFn = async (path, options) => {
    calls.push({
      path,
      method: options?.method ?? 'GET',
      body: options?.body,
    })
    return handler(path, options)
  }

  return { request, calls }
}

/** ofetch が投げるものに似せたエラー。 */
export function httpError(status: number, body?: unknown): Error {
  const error = new Error(`HTTP ${status}`) as Error & {
    status: number
    statusCode: number
    data?: unknown
  }
  error.status = status
  error.statusCode = status
  error.data = body
  return error
}

/** 通信できないときのエラー（応答がない）。 */
export function networkError(): Error {
  return new TypeError('Failed to fetch')
}
