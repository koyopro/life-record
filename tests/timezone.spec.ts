import { describe, expect, it } from 'vitest'
import { applyAppTimeZone } from '~~/server/utils/timezone'
import { parseSmartAdd } from '~~/shared/utils/smart-add'

/**
 * サーバー側の時計（docs/08-todo-management.md 8.5）。
 *
 * 期限の解釈はサーバーとクライアントで同じコードを動かすため、動かす場所の
 * 時計がずれると保存される期限もずれる。
 */
describe('実行環境のタイムゾーン', () => {
  it('すでに設定されていても、アプリのタイムゾーンで上書きする', () => {
    // Vercel の実行環境（AWS Lambda）は TZ=:UTC を渡してくる。
    // 「未設定なら入れる」では UTC のまま残り、期限が1日ずれる
    const env = { TZ: ':UTC' }

    applyAppTimeZone(env)

    expect(env.TZ).toBe('Asia/Tokyo')
  })

  it('設定されていなければ入れる', () => {
    const env: Record<string, string | undefined> = {}

    applyAppTimeZone(env)

    expect(env.TZ).toBe('Asia/Tokyo')
  })

  /**
   * 上のことが要る理由。日付だけの期限は「その日の 23:59」を**その場の時計で**
   * 組み立てるため、UTC で動かすと日本時間では翌朝 8:59（＝明日）になる。
   *
   * スマートリストからの追加は、条件の日付を `^2026/08/28` の形で書き戻して
   * サーバーへ送るので、ここがずれると追加したタスクの期限が必ず1日ずれる。
   */
  it('日付だけの期限は、日本時間のその日の 23:59 になる', () => {
    const parsed = parseSmartAdd('テスト ^2026/08/28')

    expect(parsed.dueAt?.toISOString()).toBe('2026-08-28T14:59:00.000Z')
  })
})
