import { describe, expect, it } from 'vitest'
import { withPatch } from '~/utils/offline/todo-actions'
import { toLocalItem } from '~/utils/offline/todo-repository'
import { itemDto } from '../helpers'

/**
 * ローカルでの patch 適用（サーバー側 items.patch.ts と同じ結果になるべきもの）。
 *
 * completedAt は status の遷移だけから決まるので、遷移の向きごとに確かめる
 * （docs/02-data-model.md 2.3、docs/08-todo-management.md 8.3）。
 */
describe('withPatch の completedAt', () => {
  it('open から closed へ変えたら、今の時刻を入れる', () => {
    const local = toLocalItem(itemDto({ status: 'backlog', completedAt: null }))
    const next = withPatch(local, { status: 'closed' }, '2026-08-19T03:00:00.000Z')
    expect(next.completedAt).toBe('2026-08-19T03:00:00.000Z')
  })

  it('closed から別の status へ戻したら、null に戻す', () => {
    const local = toLocalItem(
      itemDto({ status: 'closed', completedAt: '2026-08-18T00:00:00.000Z' }),
    )
    const next = withPatch(local, { status: 'backlog' }, '2026-08-19T03:00:00.000Z')
    expect(next.completedAt).toBeNull()
  })

  it('closed のまま他の項目だけ変えても、completedAt は保つ', () => {
    const local = toLocalItem(
      itemDto({ status: 'closed', completedAt: '2026-08-18T00:00:00.000Z' }),
    )
    const next = withPatch(local, { priority: 1 }, '2026-08-19T03:00:00.000Z')
    expect(next.completedAt).toBe('2026-08-18T00:00:00.000Z')
  })

  it('open のまま status を変えなければ、completedAt は null のまま', () => {
    const local = toLocalItem(itemDto({ status: 'backlog', completedAt: null }))
    const next = withPatch(local, { priority: 2 }, '2026-08-19T03:00:00.000Z')
    expect(next.completedAt).toBeNull()
  })
})

/**
 * メモ（docs/02-data-model.md 2.3）。
 *
 * オフラインでも書けるよう、ローカルにも同じ内容を当てる。空にしたときは
 * サーバー（item-patch.ts）と同じく「無い」に戻す。
 */
describe('withPatch のメモ', () => {
  it('書いた内容をローカルにも当て、未送信の印を付ける', () => {
    const local = toLocalItem(itemDto({ note: null }))

    const next = withPatch(local, { note: '鍵は3階' }, '2026-08-19T03:00:00.000Z')

    expect(next.note).toBe('鍵は3階')
    expect(next.syncState).toBe('pending_update')
  })

  it('null にしたら消える', () => {
    const local = toLocalItem(itemDto({ note: '鍵は3階' }))

    const next = withPatch(local, { note: null }, '2026-08-19T03:00:00.000Z')

    expect(next.note).toBeNull()
  })

  it('メモを変えても、他の項目はそのまま', () => {
    const local = toLocalItem(itemDto({ note: null, url: 'https://example.com' }))

    const next = withPatch(local, { note: '毎回ここを見る' }, '2026-08-19T03:00:00.000Z')

    expect(next.url).toBe('https://example.com')
    expect(next.title).toBe(local.title)
  })
})
