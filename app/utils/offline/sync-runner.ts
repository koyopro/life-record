import type { ItemDetailDto, ItemDto, SectionDto } from '~~/shared/types/item'
import type { DiaryDto } from '~~/shared/types/diary'
import type { PendingOperation } from './local-database'
import type {
  CreatePayload,
  DeletePayload,
  DiarySavePayload,
  PatchPayload,
  RestorePayload,
  SectionDeletePayload,
  SectionReorderPayload,
  SectionSavePayload,
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
   * 本文のときは、保存できた作業記録（section / sections）や日記（diary）。
   */
  | {
      type: 'done'
      item?: ItemDto
      detail?: ItemDetailDto
      section?: SectionDto
      sections?: SectionDto[]
      diary?: DiaryDto
    }
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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** 送信を打ち切るための合図（`withSendTimeout` が渡す）。 */
  signal?: AbortSignal
}

export type RequestFn = (path: string, options?: RequestOptions) => Promise<unknown>

/**
 * 1回の送受信を待つ上限。
 *
 * 応答が返ってこない送信が1つあると、**列がそこで永久に止まる**（送信は
 * 1つずつ、前が終わってから次へ進む）。画面には「未同期（n）」と点滅する●が
 * 出たままで、再読み込みでも直らない。ブラウザの fetch には既定の上限が
 * 無いので、こちらで区切る。
 *
 * 電波の悪い場所でも通ることを優先して、長めに取る。打ち切っても操作は
 * 列に残り、間隔を空けて送り直される（すべての操作は冪等。12.6）。
 */
export const REQUEST_TIMEOUT_MS = 30_000

/**
 * 送信に上限を付ける。
 *
 * 打ち切りは2重にする。`signal` で実際の通信を止めた上で、**待つのをやめる
 * 側も自分で区切る**。止める合図を無視する実装（WebView の詰まった fetch）に
 * 当たっても、列は必ず先へ進む。
 *
 * 応答が返らなかったのと同じ形（status を持たないエラー）で投げるので、
 * 一時的な失敗として送り直しの対象になる（`classify`）。
 */
export function withSendTimeout(
  request: RequestFn,
  ms: number = REQUEST_TIMEOUT_MS,
): RequestFn {
  return async (path, options) => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new TypeError(`送信が ${Math.round(ms / 1000)} 秒で終わりませんでした`))
      }, ms)
    })

    try {
      return await Promise.race([
        request(path, { ...options, signal: controller.signal }),
        limit,
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}

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

      case 'section_save': {
        const payload = operation.payload as SectionSavePayload
        // id は手元で決めている。同じ id で二度届いても、サーバーは
        // 同じ1件を上書きするだけ（server/api/sections/[id].put.ts）
        const section = (await request(`/api/sections/${payload.id}`, {
          method: 'PUT',
          body: {
            itemId: payload.itemId,
            date: payload.date,
            body: payload.body,
            // 日記でのピン留め（docs/03-functional-spec.md 3.3）
            pinned: payload.pinned === true,
          },
        })) as SectionDto
        return { type: 'done', section }
      }

      case 'section_delete': {
        const payload = operation.payload as SectionDeletePayload
        await request(`/api/sections/${payload.id}`, { method: 'DELETE' })
        return { type: 'done' }
      }

      case 'section_reorder': {
        const payload = operation.payload as SectionReorderPayload
        const sections = (await request('/api/sections/reorder', {
          method: 'POST',
          body: { ids: payload.ids },
        })) as SectionDto[]
        return { type: 'done', sections }
      }

      case 'diary_save': {
        const payload = operation.payload as DiarySavePayload
        const diary = (await request(`/api/diaries/${payload.date}`, {
          method: 'PUT',
          body: { body: payload.body },
        })) as DiaryDto
        return { type: 'done', diary }
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
    /*
     * 本文の宛先が無い。作業記録なら、その記録か Item が他の端末で消えている。
     * 送り直しても通らないので、この操作は送り終えたものとして列から外す
     * （手元の記録は、次にサーバーから取り直したときに整理される）。
     */
    if (isBodyKind(operation.kind)) return { type: 'done' }
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
 * 本文（作業記録・日記）の操作か。
 *
 * 本文は競合の確認（`baseUpdatedAt`）を付けずに送る。最後に書いたものが
 * 残るだけでよく、失敗の扱いも Item とは分かれる（docs/12-offline.md 12.5）。
 */
function isBodyKind(kind: PendingOperation['kind']): boolean {
  return (
    kind === 'section_save' ||
    kind === 'section_delete' ||
    kind === 'section_reorder' ||
    kind === 'diary_save'
  )
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

/**
 * サーバーは message で返す（docs/04-architecture.md 4.4）。
 *
 * 空文字は「無い」として扱う。そのまま採ると、画面の「直近の失敗」が
 * 空欄になり、何が起きたのか読めない（既定の文言に落とす）。
 */
function messageOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as { data?: { message?: unknown }; message?: unknown }
  for (const value of [candidate.data?.message, candidate.message]) {
    if (typeof value === 'string' && value.trim()) return value
  }
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
