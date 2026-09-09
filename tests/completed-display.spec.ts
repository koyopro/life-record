import { describe, expect, it } from 'vitest'
import { formatCompleted } from '~/utils/due'

/**
 * 完了側の一覧で、右側に出す日時（docs/08-todo-management.md 8.2）。
 *
 * 期限ではなく完了日時を出す。期限はもう役目を終えていて、完了したものに
 * ついて知りたいのは、いつ終えたかであるため。
 */
describe('formatCompleted', () => {
  /** 2026-09-09（水）の 18:30。 */
  const now = new Date('2026-09-09T18:30:00+09:00')

  it('今日は時刻だけ出す（先頭に集まるので、今日のことだと分かる）', () => {
    expect(formatCompleted('2026-09-09T15:32:00+09:00', now)).toBe('15:32')
  })

  it('昨日は時刻まで出す（完了した順に並ぶので、前後が読める）', () => {
    expect(formatCompleted('2026-09-08T09:04:00+09:00', now)).toBe('昨日 09:04')
  })

  it('一週間前までは相対、それより前は日付', () => {
    expect(formatCompleted('2026-09-06T10:00:00+09:00', now)).toBe('3日前')
    expect(formatCompleted('2026-08-20T10:00:00+09:00', now)).toBe('8月20日')
    expect(formatCompleted('2025-12-31T10:00:00+09:00', now)).toBe('2025年12月31日')
  })

  it('完了していなければ何も出さない', () => {
    expect(formatCompleted(null, now)).toBe('')
  })
})
