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
    if (overdueDays === 0) return { label: `今日${time}`, state: 'overdue' }
    if (overdueDays === 1) return { label: '昨日', state: 'overdue' }
    if (overdueDays <= 7) return { label: `${overdueDays}日前`, state: 'overdue' }
    return { label: formatAbsoluteDate(due, now), state: 'overdue' }
  }

  if (diff === 0) return { label: `今日${time}`, state: 'today' }
  if (diff === 1) return { label: `明日${time}`, state: 'tomorrow' }
  if (diff <= 7) {
    return { label: `${WEEKDAYS[due.getDay()]}曜${time}`, state: 'soon' }
  }

  return { label: `${formatAbsoluteDate(due, now)}${time}`, state: 'later' }
}

function formatAbsoluteDate(due: Date, now: Date): string {
  const sameYear = due.getFullYear() === now.getFullYear()
  return sameYear
    ? `${due.getMonth() + 1}月${due.getDate()}日`
    : `${due.getFullYear()}年${due.getMonth() + 1}月${due.getDate()}日`
}

/** 期限ダイアログの候補（{@link matchDuePresets}）。 */
export interface DuePreset {
  /** 候補として出す名前。 */
  label: string
  /**
   * 前方一致で拾う語。
   *
   * 日本語からも英語からも引けるようにする。日本語入力に切り替えずに
   * `tod` `tom` と打って選べるようにするのが主な狙い。
   */
  keywords: string[]
  /**
   * 選んだときに解釈させる式。
   *
   * 日付の計算は SmartAdd（parseDueExpression）に任せ、ここでは持たない。
   * 同じ書き方が SmartAdd の `^` でも通ることが保証される。
   */
  expression: string
}

/**
 * よく使う期限の候補。並びがそのまま候補の並び順になる。
 *
 * 上から順に、よく使うものを置く。曜日は 7 つあってどうしても長くなるため
 * 後ろにまとめる。ここに無い書き方（`8/25 15:00` など）も、入力そのものを
 * 解釈するので今までどおり使える。
 */
export const DUE_PRESETS: DuePreset[] = [
  { label: '今日', keywords: ['今日', 'きょう', 'kyou', 'today'], expression: '今日' },
  {
    label: '明日',
    keywords: ['明日', 'あした', 'あす', 'ashita', 'asu', 'tomorrow'],
    expression: '明日',
  },
  {
    label: '今週末',
    keywords: ['今週末', '週末', 'こんしゅうまつ', 'weekend', 'this weekend'],
    expression: '今週末',
  },
  {
    label: '来週',
    keywords: ['来週', 'らいしゅう', 'raishuu', 'next week'],
    expression: '来週',
  },
  { label: '来週末', keywords: ['来週末', 'next weekend'], expression: '来週末' },
  {
    label: '月末',
    keywords: ['月末', '今月末', 'げつまつ', 'end of month', 'eom'],
    expression: '月末',
  },
  {
    label: '来月',
    keywords: ['来月', 'らいげつ', 'raigetsu', 'next month'],
    expression: '来月',
  },
  { label: '来年', keywords: ['来年', 'らいねん', 'next year'], expression: '来年' },
  {
    label: '月曜',
    keywords: ['月曜', '月曜日', 'げつよう', 'monday'],
    expression: '月曜',
  },
  {
    label: '火曜',
    keywords: ['火曜', '火曜日', 'かよう', 'tuesday'],
    expression: '火曜',
  },
  {
    label: '水曜',
    keywords: ['水曜', '水曜日', 'すいよう', 'wednesday'],
    expression: '水曜',
  },
  {
    label: '木曜',
    keywords: ['木曜', '木曜日', 'もくよう', 'thursday'],
    expression: '木曜',
  },
  {
    label: '金曜',
    keywords: ['金曜', '金曜日', 'きんよう', 'friday'],
    expression: '金曜',
  },
  {
    label: '土曜',
    keywords: ['土曜', '土曜日', 'どよう', 'saturday'],
    expression: '土曜',
  },
  {
    label: '日曜',
    keywords: ['日曜', '日曜日', 'にちよう', 'sunday'],
    expression: '日曜',
  },
  {
    label: '期限なし',
    keywords: ['なし', '期限なし', 'x', 'none', 'clear'],
    expression: 'なし',
  },
]

/**
 * 入力に前方一致する候補を返す。空の入力なら全部。
 *
 * 前方一致だけにするのは、`tod` と打った時点で「今日」だけに絞れる
 * ようにするため。部分一致だと関係ない候補が残って選びにくい。
 */
export function matchDuePresets(text: string): DuePreset[] {
  const needle = text.trim().toLowerCase()
  if (!needle) return DUE_PRESETS

  return DUE_PRESETS.filter((preset) =>
    preset.keywords.some((keyword) => keyword.toLowerCase().startsWith(needle)),
  )
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
