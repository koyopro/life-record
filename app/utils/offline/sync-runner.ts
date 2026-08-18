import type { ItemDetailDto, ItemDto } from '~~/shared/types/item'
import type { PendingOperation } from './local-database'
import type {
  CreatePayload,
  DeletePayload,
  PatchPayload,
  RestorePayload,
  TagsPayload,
} from './sync-queue'

/**
 * 未送信の操作を1つサーバーへ送り、結果を判定する。
 *
 * 送信そのものと、失敗の分類（送り直せるのか・諦めるのか・競合なのか）を
 * ここに閉じ込める。判定はテストしたいので、通信は引数で受け取る。
 */

export type SyncOutcome =
  /**
   * 通った。サーバーが返した最新の内容（あれば）を添える。
   * 削除のときは、取り消しで戻すための控え（detail）が付く。
   */
  | { type: 'done'; item?: ItemDto; detail?: ItemDetailDto }
  /**
   * 競合。こちらが見ていた版より後に、サーバー側が変わっていた。
   * サーバー側を採る（docs/12-offline.md 12.5）。
   */
  | { type: 'conflict'; reason: 'server_newer' | 'server_deleted'; server: ItemDto | null }
  /** 一時的な失敗。間隔を空けて送り直す。 */
  | { type: 'retry'; message: string; offline: boolean }
  /** 決着しない失敗。自動での送り直しはやめる。 */
  | { type: 'failed'; message: string }

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
}

export type RequestFn = (path: string, options?: RequestOptions) => Promise<unknown>

export async function runOperation(
  operation: PendingOperation,
  request: RequestFn,
): Promise<SyncOutcome> {
  try {
    switch (operation.kind) {
      case 'create': {
        const payload = operation.payload as CreatePayload
        // id はクライアントが決めている。同じ id で二度届いても、
        // サーバーは既にあるものを返すだけ（server/api/items.post.ts）
        const item = (await request('/api/items', {
          method: 'POST',
          body: { id: payload.id, text: payload.text },
        })) as ItemDto
        return { type: 'done', item }
      }

      case 'patch': {
        const payload = operation.payload as PatchPayload
        const item = (await request(`/api/items/${payload.id}`, {
          method: 'PATCH',
          body: { ...payload.patch, baseUpdatedAt: payload.baseUpdatedAt },
        })) as ItemDto
        return { type: 'done', item }
      }

      case 'delete': {
        const payload = operation.payload as DeletePayload
        // 削除の応答は、取り消し（`u`）で Section ごと戻すための控え
        const detail = (await request(`/api/items/${payload.id}`, {
          method: 'DELETE',
        })) as ItemDetailDto
        return { type: 'done', detail }
      }

      case 'tags': {
        const payload = operation.payload as TagsPayload
        const items = (await request('/api/items/tags', {
          method: 'POST',
          body: { ids: payload.ids, add: payload.add, remove: payload.remove },
        })) as ItemDto[]
        // 1件ずつ積んでいるので、返るのも1件
        return { type: 'done', item: items[0] }
      }

      case 'restore': {
        const payload = operation.payload as RestorePayload
        const item = (await request('/api/items/restore', {
          method: 'POST',
          body: payload.snapshot,
        })) as ItemDto
        return { type: 'done', item }
      }
    }
  } catch (error) {
    return classify(error, operation)
  }
}

/**
 * 失敗の内容を見て、次にどうするか決める。
 *
 * - 通信できていない / サーバーが落ちている → 送り直す
 * - 認証が切れた（401 / 403）→ 送り直す。入り直せば通るため消さない
 * - 消えている（404）→ 削除なら成功と同じ。更新なら競合として扱う
 * - 競合（409）→ サーバー側を採る
 * - それ以外の 4xx → 内容の問題なので、投げ続けても通らない
 */
function classify(error: unknown, operation: PendingOperation): SyncOutcome {
  const status = statusOf(error)
  const message = messageOf(error)

  if (status === undefined) {
    return { type: 'retry', message: message ?? '通信できませんでした', offline: true }
  }

  if (status === 409) {
    return {
      type: 'conflict',
      reason: 'server_newer',
      server: serverItemOf(error),
    }
  }

  if (status === 404) {
    if (operation.kind === 'delete') return { type: 'done' }
    return { type: 'conflict', reason: 'server_deleted', server: null }
  }

  if (status === 401 || status === 403 || status === 408 || status === 429) {
    return {
      type: 'retry',
      message: message ?? 'いまは送れませんでした',
      offline: false,
    }
  }

  if (status >= 500) {
    return {
      type: 'retry',
      message: message ?? 'サーバーが応答しませんでした',
      offline: false,
    }
  }

  return { type: 'failed', message: message ?? '送信できませんでした' }
}

/**
 * 応答そのものが返ってこなかったか（＝サーバーへ届いていない）。
 *
 * `navigator.onLine` は電波の有無しか見ていない。繋がっているのに
 * 通信できない場合を捉えるため、実際の失敗の形から判断する。
 */
export function isNetworkError(error: unknown): boolean {
  return statusOf(error) === undefined
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
  }
  for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
    if (typeof value === 'number' && value > 0) return value
  }
  return undefined
}

/** サーバーは message で返す（docs/04-architecture.md 4.4）。 */
function messageOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as { data?: { message?: unknown }; message?: unknown }
  if (typeof candidate.data?.message === 'string') return candidate.data.message
  if (typeof candidate.message === 'string') return candidate.message
  return null
}

/** 409 のときサーバーが添えてくる、いまの内容。 */
function serverItemOf(error: unknown): ItemDto | null {
  if (typeof error !== 'object' || error === null) return null
  const body = (error as { data?: { data?: { item?: unknown } } }).data
  const item = body?.data?.item
  if (typeof item === 'object' && item !== null && 'id' in item) return item as ItemDto
  return null
}
