import type { ItemDto } from '~~/shared/types/item'

export type DueState = 'none' | 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later'

export interface DueDisplay {
  label: string
  state: DueState
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** その日の 0:00 を返す。日数差の計算に使う。 */
function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY,
  )
}

/**
 * 期限を相対表現で表示する（docs/08-todo-management.md 8.2）。
 *
 * 絶対日付より「今日」「明日」のほうが読み取りが速いため、
 * 近い日付は相対表現を優先する。
 */
export function formatDue(item: ItemDto, now = new Date()): DueDisplay {
  if (!item.dueAt) return { label: '', state: 'none' }

  const due = new Date(item.dueAt)
  const diff = daysBetween(now, due)
  const time = item.dueHasTime
    ? ` ${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`
    : ''

  // 時刻の指定があるなら時刻まで見て、なければ日付だけで期限切れを判定する
  const isOverdue = item.dueHasTime ? due.getTime() < now.getTime() : diff < 0

  if (isOverdue) {
    const overdueDays = diff < 0 ? -diff : 0
    const suffix = overdueDays > 0 ? `（${overdueDays}日前）` : ''
    return { label: `期限切れ${suffix}`, state: 'overdue' }
  }

  if (diff === 0) return { label: `今日${time}`, state: 'today' }
  if (diff === 1) return { label: `明日${time}`, state: 'tomorrow' }
  if (diff <= 7) {
    return { label: `${WEEKDAYS[due.getDay()]}曜${time}`, state: 'soon' }
  }

  const sameYear = due.getFullYear() === now.getFullYear()
  const date = sameYear
    ? `${due.getMonth() + 1}月${due.getDate()}日`
    : `${due.getFullYear()}年${due.getMonth() + 1}月${due.getDate()}日`
  return { label: `${date}${time}`, state: 'later' }
}

/**
 * 延期（`p`）したときの期限。**今日から見た明日**にする。
 *
 * 元の期限を1日ずらすのではない。期限切れのタスクを延期したときに、
 * 期限が過去のままになってしまい、延期した意味がなくなるため。
 *
 * 時刻の指定があるものはその時刻を保つ。日付だけの期限は 23:59
 * （docs/08-todo-management.md 8.5）。
 */
export function postponedDue(item: ItemDto, now = new Date()): Date {
  const next = new Date(now)
  next.setDate(next.getDate() + 1)

  if (item.dueAt && item.dueHasTime) {
    const due = new Date(item.dueAt)
    next.setHours(due.getHours(), due.getMinutes(), 0, 0)
  } else {
    next.setHours(23, 59, 0, 0)
  }
  return next
}
