import type { BodySyncState, SyncState } from './local-database'

/**
 * サーバーから取り直した内容を重ねるときの、**ただ1つの決まり**
 * （docs/15-client-state.md 14.2 の 4）。
 *
 * TODO のメタデータも、作業記録も、日記も、重ね方はここだけを見る。
 * 種類ごとに書き分けると、片方にしか無い守りができて漏れる。
 */

/** 重ねる相手（手元の1件）。種類が違っても、見るのはこの2つだけ。 */
export interface LocalRecord {
  syncState: SyncState | BodySyncState
  /** 同期済みならサーバーが打った時刻。まだ送っていなければ null のこともある。 */
  updatedAt: string | null
}

/**
 * 手元の内容を残すか。
 *
 * 1. まだ送れていないもの（送信待ち・送信中・送れなかったもの）。
 *    オフラインで書いた分が、取り直しのたびに消えないようにする
 * 2. 送れているが、**応答を作った時刻より後に送り終えた**もの。
 *    保存より前に出した取得の応答が保存の後で届くことがあり、その内容には
 *    こちらの保存が入っていない。1 の守りは送り終わった瞬間に外れるので、
 *    これが無いと**入力したそばから巻き戻る**
 *
 * 比べるのはどちらもサーバーの時刻（同期済みの `updatedAt` はサーバーが打った
 * もの、`fetchedAt` は応答を作った時刻）なので、端末の時計がずれていても狂わない。
 */
export function keepsLocal(local: LocalRecord, fetchedAt: string): boolean {
  if (local.syncState !== 'synced') return true
  if (!local.updatedAt) return false
  return local.updatedAt > fetchedAt
}
