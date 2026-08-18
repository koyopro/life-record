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
    const local = toLocalItem(itemDto({ status: 'inbox', completedAt: null }))
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
    const local = toLocalItem(itemDto({ status: 'inbox', completedAt: null }))
    const next = withPatch(local, { priority: 2 }, '2026-08-19T03:00:00.000Z')
    expect(next.completedAt).toBeNull()
  })
})
