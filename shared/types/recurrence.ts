/**
 * 繰り返しの起点（docs/10-recurrence.md 10.1）。
 *
 * この区別が繰り返し機能の核心。取り違えると実用にならない。
 */
export const RECURRENCE_BASES = ['due', 'completion'] as const
export type RecurrenceBasis = (typeof RECURRENCE_BASES)[number]

export const BASIS_LABELS: Record<RecurrenceBasis, string> = {
  // 期限日が起点。完了が遅れても次回期限は元の期限から進む
  due: '毎',
  // 完了日が起点。前回やってからの間隔が意味を持つ
  completion: '完了から',
}

export interface Recurrence {
  /** RFC 5545 の RRULE（`FREQ=WEEKLY;INTERVAL=2` など）。 */
  rule: string
  basis: RecurrenceBasis
}

export function isRecurrenceBasis(value: unknown): value is RecurrenceBasis {
  return RECURRENCE_BASES.includes(value as RecurrenceBasis)
}
