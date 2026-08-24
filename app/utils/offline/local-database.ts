import {
  openDB,
  deleteDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb'
import type { ItemDto, SectionDto } from '~~/shared/types/item'

/**
 * ローカルの保管庫（IndexedDB）。
 *
 * 正本はサーバーの PostgreSQL で、ここはその写しと、まだ送れていない操作を
 * 置く場所（docs/12-offline.md）。長く貯めるための DB ではないので、
 * 消えてもサーバーから取り直せるものだけを持つ。
 *
 * 直接触るのはこのフォルダの中だけ。画面からは useItemStore を通す。
 */

export const DB_NAME = 'life-record'

/**
 * スキーマの版。構造を変えたら上げて、upgrade に移行手順を足す。
 * 中身はいつでもサーバーから取り直せるので、迷ったら作り直してよい。
 *
 * ただし未送信の操作（operations）だけは作り直せない。まだサーバーに
 * 届いていない変更そのものなので、移行では必ず持ち越す。
 */
export const DB_VERSION = 4

/** Item ごとの同期状態。 */
export type SyncState =
  | 'synced'
  | 'pending_create'
  | 'pending_update'
  | 'pending_delete'

/**
 * 本文（Section・日記）ごとの同期状態。
 *
 * Item と違い、作成と更新を分けない。本文は id（日記は日付）を決めてから
 * 書くもので、送るときはどちらも「その内容にする」という同じ操作になる
 * （docs/12-offline.md 12.6）。
 */
export type BodySyncState = 'synced' | 'pending_save' | 'pending_delete'

export interface LocalItem extends ItemDto {
  syncState: SyncState
  /**
   * サーバーで最後に見た updatedAt。競合の検出に使う（送信時に添える）。
   * まだ送っていない作成は null。
   */
  baseUpdatedAt: string | null
}

/**
 * 作業記録（Section）の写し。
 *
 * サーバーの `SectionDto` に、どの Item のものか（`itemId`）と同期状態を
 * 足したもの。`updatedAt` は**同期済みならサーバーが打った時刻**で、
 * 未送信の間は手元で書いた時刻。取り直した内容と突き合わせるときに使う。
 */
export interface LocalSection extends SectionDto {
  itemId: string
  syncState: BodySyncState
}

/**
 * 日記の写し。日付が主キーなので id は持たない。
 *
 * 本文が空の日はサーバーに行が無い（消える）。手元では「空の日記」として
 * 残し、`updatedAt` は同期済みならサーバーの時刻、まだ届いていなければ null。
 */
export interface LocalDiary {
  date: string
  body: string
  updatedAt: string | null
  syncState: BodySyncState
}

/** 未送信の操作の種類。API のエンドポイントに1対1で対応する。 */
export type OperationKind =
  | 'create'
  | 'patch'
  | 'delete'
  | 'tags'
  | 'restore'
  | 'section_save'
  | 'section_delete'
  | 'section_reorder'
  | 'diary_save'

export interface PendingOperation {
  /**
   * 積んだ順の通し番号。IndexedDB が採番する。
   *
   * 時刻で並べると、同じミリ秒に積んだ操作の前後が決まらない。
   * 続けざまの操作（完了にしてすぐ取り消す）が入れ替わってしまうため、
   * 順序はこの番号で持つ。
   */
  seq: number
  /**
   * 操作ID。クライアントが発行する冪等キー。
   *
   * 送信は成功したが応答を受け取れなかった場合、同じ操作をもう一度送る。
   * サーバー側が二重に処理しないよう、この ID と Item の id で識別する
   * （docs/12-offline.md 12.6）。
   */
  opId: string
  kind: OperationKind
  /** 対象の Item。未同期の印を一覧に出すために持つ。 */
  itemIds: string[]
  payload: unknown
  createdAt: string
  attempts: number
  /** 次に送ってよい時刻（ISO）。失敗するたびに後ろへ倒す。 */
  nextAttemptAt: string
  /**
   * 自動での送り直しをやめた操作。
   * 消さずに残し、UI から手で送り直せるようにする。
   */
  givenUp: boolean
  lastError: string | null
}

/** 競合を検出したときの記録。サーバー側を採ったことを人に伝えるために残す。 */
export interface ConflictRecord {
  itemId: string
  title: string
  detectedAt: string
  /** 採用しなかったローカルの変更内容。 */
  discarded: Record<string, unknown>
  reason: 'server_newer' | 'server_deleted'
}

interface MetaRecord {
  key: string
  value: unknown
}

/**
 * 一度見た画像の控え（docs/11-scrapbox-notation.md 11.7）。
 *
 * 画像は S3 にあり、表示のたびに「リダイレクトを引く → S3 から読む」の
 * 2往復が要る。ブラウザの持っている分で済むこともあるが、署名付き URL は
 * 1時間ごとに変わるうえ、アプリの WebView（macOS アプリ）では持ち越されない
 * ことがあり、**一度見た画像でも出るまで待たされる**。
 *
 * そこで中身そのものを手元に置く。次からは通信せずに出せる。
 */
export interface LocalImage {
  /** 本文に書くパス（`/images/<ID>.<拡張子>`）。これが主キー。 */
  path: string
  /**
   * 中身。Blob ではなく ArrayBuffer で持つ。
   *
   * WebKit（Safari と、macOS アプリの WebView）は IndexedDB に入れた Blob の
   * 扱いに穴があり、入れたはずのものが読めないことがある。ArrayBuffer なら
   * どの環境でもそのまま出し入れできる。読むときに Blob へ組み直す。
   */
  bytes: ArrayBuffer
  /** MIME タイプ。Blob へ組み直すときに要る。 */
  type: string
  size: number
  savedAt: string
  /** 最後に使った時刻。置き場が一杯になったら古いものから捨てる。 */
  usedAt: string
}

interface LifeRecordDb extends DBSchema {
  items: {
    key: string
    value: LocalItem
    indexes: { 'by-sync-state': SyncState }
  }
  /** 主キーが積んだ順（seq）。getAll() がそのまま送る順になる。 */
  operations: {
    key: number
    value: PendingOperation
    indexes: { 'by-op-id': string }
  }
  conflicts: { key: string; value: ConflictRecord }
  /**
   * 作業記録。Item ごと（詳細画面）と日付ごと（日記の「この日にやったこと」）に
   * 引けるようにする。
   */
  sections: {
    key: string
    value: LocalSection
    indexes: { 'by-item': string; 'by-date': string }
  }
  /** 日記。主キーは日付（YYYY-MM-DD）。 */
  diaries: { key: string; value: LocalDiary }
  /** 最終取得日時などの雑多な値。 */
  meta: { key: string; value: MetaRecord }
  /** 一度見た画像の中身。古く使ったものから捨てるので、その順で引けるようにする。 */
  images: {
    key: string
    value: LocalImage
    indexes: { 'by-used-at': string }
  }
}

export type LocalDatabase = IDBPDatabase<LifeRecordDb>

/** 版を上げる間だけ使える取引。upgrade が受け取るもの。 */
type UpgradeTransaction = IDBPTransaction<
  LifeRecordDb,
  ArrayLike<StoreNames<LifeRecordDb>>,
  'versionchange'
>

/** 未送信の操作を置くストア。主キーは積んだ順（seq）。 */
function createOperationsStore(db: LocalDatabase) {
  const operations = db.createObjectStore('operations', {
    keyPath: 'seq',
    autoIncrement: true,
  })
  operations.createIndex('by-op-id', 'opId', { unique: true })
  return operations
}

/**
 * 版 1 で作られた operations を、seq を主キーとする形へ作り直す。
 *
 * 順序の持ち方を opId から seq（IndexedDB の採番）へ変えたとき、版を
 * 上げ忘れていた。そのため、それより前に DB を作ったブラウザだけが
 * `keyPath: 'opId'` のまま残っている。この形では操作が seq を持たないので
 * 削除の宛先が決まらず（`removeOperation` が例外になる）、送信の列が
 * 一度も流れない。未送信の操作はサーバーへ届いていない変更そのものなので、
 * 捨てずに積み直す。
 *
 * 積んだ順は createdAt から復元する。古い形では取り出しが opId（UUID）順に
 * なるため、積んだ順そのものは残っていない。
 */
async function migrateOperationsToSeq(
  db: LocalDatabase,
  transaction: UpgradeTransaction,
): Promise<void> {
  const existing = transaction.objectStore('operations')
  // 版 1 でも、変更のあとに作られた DB はすでに新しい形
  if (existing.keyPath === 'seq') return

  const kept = [...(await existing.getAll())].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : 1,
  )

  db.deleteObjectStore('operations')
  const operations = createOperationsStore(db)

  for (const operation of kept) {
    // seq は積み直しで採番される。持っていない値は渡さない
    const { seq: _unset, ...rest } = operation
    await operations.add(rest as PendingOperation)
  }
}

let connection: Promise<LocalDatabase> | null = null

/**
 * 接続を開く。開いたものは使い回す。
 *
 * ブラウザにしか無い API なので、SSR 中に呼んではいけない。
 */
export function openLocalDatabase(): Promise<LocalDatabase> {
  // サーバー描画中は存在しない。呼ぶ側の取りこぼしをここで止める
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB はブラウザでのみ使える'))
  }

  if (!connection) {
    connection = openDB<LifeRecordDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // 版ごとに積み上げる。古い版からでも順に辿って最新へ着く。
        if (oldVersion < 1) {
          const items = db.createObjectStore('items', { keyPath: 'id' })
          items.createIndex('by-sync-state', 'syncState')

          createOperationsStore(db)

          db.createObjectStore('conflicts', { keyPath: 'itemId' })
          db.createObjectStore('meta', { keyPath: 'key' })
        }

        // 本文（作業記録と日記）もローカルに持つようにした（docs/12-offline.md 12.3）
        if (oldVersion < 3) {
          const sections = db.createObjectStore('sections', { keyPath: 'id' })
          sections.createIndex('by-item', 'itemId')
          sections.createIndex('by-date', 'date')

          db.createObjectStore('diaries', { keyPath: 'date' })
        }

        // 一度見た画像の中身を持つようにした（docs/11-scrapbox-notation.md 11.7）
        if (oldVersion < 4) {
          const images = db.createObjectStore('images', { keyPath: 'path' })
          images.createIndex('by-used-at', 'usedAt')
        }

        // 作り直しは非同期になるので最後に置く。オブジェクトストアの作成は
        // 版を上げる取引が開いている間（＝待つ前）に済ませておく必要がある
        if (oldVersion === 1) return migrateOperationsToSeq(db, transaction)
      },
      /**
       * 別のタブが新しい版へ上げようとしている。
       * こちらが閉じないと相手が開けないので、接続を手放す。
       */
      blocking(_currentVersion, _blockedVersion, event) {
        ;(event.target as IDBPDatabase | null)?.close()
        connection = null
      },
      terminated() {
        // ブラウザ側の都合で切れた。次の呼び出しで開き直す
        connection = null
      },
    })
  }

  return connection
}

/** 接続を閉じる。テストと、版を上げるときに使う。 */
export async function closeLocalDatabase(): Promise<void> {
  if (!connection) return
  const db = await connection.catch(() => null)
  db?.close()
  connection = null
}

/**
 * ローカルの内容をすべて捨てる。
 *
 * 表示がおかしくなったときの逃げ道。正本はサーバーにあるので、
 * 捨てても取り直せる。未送信の操作も消えるため、UI からは確認の上で呼ぶ。
 */
export async function deleteLocalDatabase(): Promise<void> {
  await closeLocalDatabase()
  await deleteDB(DB_NAME)
}
