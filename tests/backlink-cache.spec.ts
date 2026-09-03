import { describe, expect, it } from 'vitest'
import type { Backlink } from '~~/shared/types/backlink'
import {
  BACKLINK_REMEMBER_LIMIT,
  findBacklinks,
  mergeRemembered,
  parseBacklinkEntries,
  rememberBacklinks,
  type BacklinkEntry,
} from '~/utils/backlink-cache'

/**
 * 「このページを指しているもの」の控え
 * （docs/11-scrapbox-notation.md 11.11 / docs/12-offline.md 12.9）。
 *
 * 一度見た月へ戻ったときに「読み込み中…」へ戻らないよう、前回の内容を
 * 出しながら裏で取り直す。ここで見るのは覚え方だけ（取得は composable）。
 */

function link(id: string): Backlink {
  return {
    id,
    kind: 'item',
    date: '2026-09-01',
    path: `/items/${id}`,
    title: `タスク ${id}`,
    head: { text: '', truncated: false },
    item: null,
  }
}

const MONTH = '/diary/month/2026-09'

describe('バックリンクの控え', () => {
  it('控えたページは引ける。持っていないページは null（0件と区別する）', () => {
    const entries = rememberBacklinks([], MONTH, [link('a')])

    expect(findBacklinks(entries, MONTH)).toEqual([link('a')])
    expect(findBacklinks(entries, '/diary/month/2026-08')).toBeNull()

    // 「指しているものが無い」も控える。次に開いたときに取り直しを待たせない
    const emptied = rememberBacklinks(entries, '/diary/month/2026-08', [])
    expect(findBacklinks(emptied, '/diary/month/2026-08')).toEqual([])
  })

  it('取り直した内容で置き換える（同じページの控えを2つ持たない）', () => {
    const first = rememberBacklinks([], MONTH, [link('a')])
    const second = rememberBacklinks(first, MONTH, [link('a'), link('b')])

    expect(second).toHaveLength(1)
    expect(findBacklinks(second, MONTH)).toHaveLength(2)
  })

  it('新しいものを先頭に置き、上限を超えた古い控えから捨てる', () => {
    let entries: BacklinkEntry[] = []
    for (let i = 0; i < BACKLINK_REMEMBER_LIMIT + 2; i += 1) {
      entries = rememberBacklinks(entries, `/diary/month/2026-${i}`, [link(`${i}`)])
    }

    expect(entries).toHaveLength(BACKLINK_REMEMBER_LIMIT)
    expect(entries[0]?.path).toBe(`/diary/month/2026-${BACKLINK_REMEMBER_LIMIT + 1}`)
    // いちばん古い2つは落ちている
    expect(findBacklinks(entries, '/diary/month/2026-0')).toBeNull()
    expect(findBacklinks(entries, '/diary/month/2026-1')).toBeNull()
  })

  it('localStorage の控えは、いま持っていないページにだけ足す', () => {
    // サーバー描画で取れている月（新しい）と、控えにある月（古い）
    const current = rememberBacklinks([], MONTH, [link('新')])
    const stored = [
      { path: MONTH, links: [link('古')] },
      { path: '/diary/month/2026-08', links: [link('先月')] },
    ]

    const merged = mergeRemembered(current, stored)

    expect(findBacklinks(merged, MONTH)).toEqual([link('新')])
    expect(findBacklinks(merged, '/diary/month/2026-08')).toEqual([link('先月')])
  })

  it('壊れた控え・形の違う控えは捨てる', () => {
    expect(parseBacklinkEntries('{')).toEqual([])
    expect(parseBacklinkEntries('{"path":"/diary/month/2026-09"}')).toEqual([])
    expect(parseBacklinkEntries('[null,{"path":1,"links":[]},{"path":"/x"}]')).toEqual([])

    const stored = JSON.stringify(rememberBacklinks([], MONTH, [link('a')]))
    expect(parseBacklinkEntries(stored)).toEqual([{ path: MONTH, links: [link('a')] }])
  })
})
