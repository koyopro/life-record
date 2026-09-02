import { describe, expect, it } from 'vitest'
import { keepsLocal, type LocalRecord } from '~/utils/offline/freshness'

/**
 * サーバーから取り直した内容を重ねるときの、ただ1つの決まり
 * （docs/15-client-state.md 14.2 の 4）。
 *
 * TODO のメタデータも作業記録も日記も、ここだけを見て重ねる。種類ごとに
 * 書き分けると、片方にしか無い守りができて漏れる（題や優先度が入力した
 * そばから巻き戻ったのがそれだった）。
 */
describe('keepsLocal', () => {
  /** 応答を作った時刻。これより後の保存は、応答がまだ知らない。 */
  const FETCHED_AT = '2026-09-01T10:00:00.000Z'

  const cases: [string, LocalRecord, boolean][] = [
    [
      '未送信（オフラインで直した分）は残す',
      { syncState: 'pending_update', updatedAt: '2026-08-01T00:00:00.000Z' },
      true,
    ],
    [
      '送信待ちの作成も残す',
      { syncState: 'pending_create', updatedAt: '2026-08-01T00:00:00.000Z' },
      true,
    ],
    [
      '消す途中のものも残す（送り終えるまでは取り消せる）',
      { syncState: 'pending_delete', updatedAt: '2026-08-01T00:00:00.000Z' },
      true,
    ],
    [
      '本文の送信待ちも残す',
      { syncState: 'pending_save', updatedAt: '2026-08-01T00:00:00.000Z' },
      true,
    ],
    [
      '応答より後に送り終えた分は残す（この応答はまだ知らない）',
      { syncState: 'synced', updatedAt: '2026-09-01T10:00:05.000Z' },
      true,
    ],
    [
      '応答より前に送り終えた分は、応答の内容で更新する',
      { syncState: 'synced', updatedAt: '2026-09-01T09:59:55.000Z' },
      false,
    ],
    [
      '同じ時刻なら応答を採る（中身は同じ）',
      { syncState: 'synced', updatedAt: FETCHED_AT },
      false,
    ],
    [
      'サーバーが時刻を打っていないもの（まだ書かれていない日記）は応答を採る',
      { syncState: 'synced', updatedAt: null },
      false,
    ],
  ]

  it.each(cases)('%s', (_label, local, expected) => {
    expect(keepsLocal(local, FETCHED_AT)).toBe(expected)
  })
})
