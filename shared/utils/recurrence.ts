// rrule は CJS パッケージで named export の静的検出ができない環境があるため
// （scripts/import-rtm.ts のような素の Node ESM 実行時など）、default import から取り出す。
import rrulePkg from 'rrule'
import type { RRule as RRuleType } from 'rrule'
import type { Recurrence, RecurrenceBasis } from '../types/recurrence'

const { RRule } = rrulePkg

/**
 * 繰り返し規則の解釈と次回期限の計算（docs/10-recurrence.md）。
 *
 * 規則は RFC 5545 の RRULE で保存する。独自形式にしないのは、
 * 他のカレンダー・タスク管理ツールへ移行しやすくするため。
 * `after`（完了日起点）は RRULE で表せないので basis で別に持つ。
 */

const WEEKDAYS: Record<string, string> = {
  月: 'MO',
  火: 'TU',
  水: 'WE',
  木: 'TH',
  金: 'FR',
  土: 'SA',
  日: 'SU',
  monday: 'MO',
  tuesday: 'TU',
  wednesday: 'WE',
  thursday: 'TH',
  friday: 'FR',
  saturday: 'SA',
  sunday: 'SU',
  mon: 'MO',
  tue: 'TU',
  wed: 'WE',
  thu: 'TH',
  fri: 'FR',
  sat: 'SA',
  sun: 'SU',
}

const FREQ_BY_UNIT: Record<string, string> = {
  日: 'DAILY',
  週: 'WEEKLY',
  週間: 'WEEKLY',
  月: 'MONTHLY',
  年: 'YEARLY',
  day: 'DAILY',
  days: 'DAILY',
  week: 'WEEKLY',
  weeks: 'WEEKLY',
  month: 'MONTHLY',
  months: 'MONTHLY',
  year: 'YEARLY',
  years: 'YEARLY',
}

/**
 * 自然言語の繰り返し表現を RRULE + basis に変換する。
 *
 * 日本語・英語の両方を受け付ける。解釈できない場合は null を返し、
 * 呼び出し側で警告を出す（黙って無視しない）。
 */
export function parseRecurrence(input: string): Recurrence | null {
  const text = input.trim().toLowerCase().replace(/^\*/, '').trim()
  if (!text) return null

  // --- 完了日起点（after / 完了の〜後） ---
  const afterMatch =
    /^after\s+(?:(\d+)\s*)?(day|days|week|weeks|month|months|year|years)$/.exec(
      text,
    ) ?? /^完了(?:の)?\s*(?:(\d+))?\s*(日|週間|週|月|年)後$/.exec(text)

  if (afterMatch) {
    const freq = FREQ_BY_UNIT[afterMatch[2]!]
    if (!freq) return null
    return {
      rule: buildRule(freq, Number(afterMatch[1] ?? 1)),
      basis: 'completion',
    }
  }

  // --- 期限日起点（every / 毎〜） ---
  const rule = parseEvery(text)
  return rule ? { rule, basis: 'due' } : null
}

function parseEvery(text: string): string | null {
  // every monday / 毎週月曜
  const weekdayMatch =
    /^every\s+([a-z]+day|mon|tue|wed|thu|fri|sat|sun)$/.exec(text) ??
    /^毎週\s*([月火水木金土日])(?:曜日?)?$/.exec(text)
  if (weekdayMatch) {
    const day = WEEKDAYS[weekdayMatch[1]!]
    if (!day) return null
    return `FREQ=WEEKLY;BYDAY=${day}`
  }

  // every 2 weeks / 2週間ごと / 隔週
  if (/^隔週$/.test(text)) return buildRule('WEEKLY', 2)
  const intervalMatch =
    /^every\s+(\d+)\s*(day|days|week|weeks|month|months|year|years)$/.exec(text) ??
    /^(\d+)\s*(日|週間|週|月|年)ごと$/.exec(text)
  if (intervalMatch) {
    const freq = FREQ_BY_UNIT[intervalMatch[2]!]
    if (!freq) return null
    return buildRule(freq, Number(intervalMatch[1]))
  }

  // every month on the 1 / 毎月1日
  const monthDayMatch =
    /^every\s+month\s+on\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/.exec(text) ??
    /^毎月\s*(\d{1,2})日$/.exec(text)
  if (monthDayMatch) {
    const day = Number(monthDayMatch[1])
    if (day < 1 || day > 31) return null
    return `FREQ=MONTHLY;BYMONTHDAY=${day}`
  }

  // every day / 毎日
  const simpleMatch =
    /^every\s+(day|week|month|year)$/.exec(text) ??
    /^毎(日|週|月|年)$/.exec(text)
  if (simpleMatch) {
    const freq = FREQ_BY_UNIT[simpleMatch[1]!]
    return freq ? buildRule(freq, 1) : null
  }

  return null
}

function buildRule(freq: string, interval: number): string {
  if (!Number.isInteger(interval) || interval < 1 || interval > 366) {
    throw new Error('繰り返しの間隔が不正です')
  }
  return interval === 1 ? `FREQ=${freq}` : `FREQ=${freq};INTERVAL=${interval}`
}

/** RRULE 文字列として妥当か。保存前の検証に使う。 */
export function isValidRule(rule: string): boolean {
  try {
    RRule.fromString(normalizeRule(rule))
    return true
  } catch {
    return false
  }
}

/** rrule は `RRULE:` 接頭辞つきを期待するので補う。 */
function normalizeRule(rule: string): string {
  return rule.startsWith('RRULE:') ? rule : `RRULE:${rule}`
}

/**
 * 次回の期限を求める（docs/10-recurrence.md 10.4）。
 *
 * @param from            basis=due なら現在の期限、basis=completion なら完了日時
 * @param completedAt     完了日時。basis=due で期限が過去のときの下限に使う
 * @param occurrencesSoFar これまでに作られた回数（自分を含む）。COUNT の判定に使う
 * @returns 次回期限。終了条件を超えていれば null
 */
export function nextDueAt(
  recurrence: Recurrence,
  from: Date,
  completedAt: Date,
  occurrencesSoFar = 1,
): Date | null {
  const options = parseOptions(recurrence.rule)
  if (!options) return null

  // COUNT は rrule に任せられない。
  // 各オカレンスは自分の期限を起点に再計算するため、dtstart が毎回動き、
  // rrule 内部のカウントが series 全体の回数と一致しないため。
  if (options.count && occurrencesSoFar >= options.count) return null

  const rule = safeRule(recurrence.rule, from)
  if (!rule) return null

  if (recurrence.basis === 'completion') {
    // 完了日を起点に1回分だけ進める。過去日になることは原理的に起きない。
    const next = rule.after(from, false)
    return withTimeOf(next, from)
  }

  // basis = due。元の期限を起点に進める。
  // 完了が大幅に遅れた場合、過去日が積み上がらないよう未来まで進める。
  const lowerBound = from > completedAt ? from : completedAt
  let candidate = rule.after(from, false)

  // 終了条件（COUNT / UNTIL）を超えたら null が返る
  while (candidate && candidate <= lowerBound) {
    const following = rule.after(candidate, false)
    if (!following) return null
    candidate = following
  }

  return withTimeOf(candidate, from)
}

function parseOptions(rule: string) {
  try {
    return RRule.parseString(normalizeRule(rule))
  } catch {
    return null
  }
}

function safeRule(rule: string, dtstart: Date): RRuleType | null {
  const parsed = parseOptions(rule)
  if (!parsed) return null
  try {
    // COUNT は自前で判定するので rrule には渡さない。
    // 渡すと dtstart が動くたびに数え直されてしまう。
    const { count: _count, ...rest } = parsed
    return new RRule({ ...rest, dtstart })
  } catch {
    return null
  }
}

/**
 * rrule が返す日付は UTC 基準なので、元の期限の時刻に合わせ直す。
 * 「23:59 の期限」が時差でずれないようにするため。
 */
function withTimeOf(date: Date | null, reference: Date): Date | null {
  if (!date) return null
  const result = new Date(date)
  result.setHours(
    reference.getHours(),
    reference.getMinutes(),
    reference.getSeconds(),
    0,
  )
  return result
}

/** RRULE を日本語の自然文にする。設定内容の確認表示に使う。 */
export function describeRecurrence(recurrence: Recurrence): string {
  const options = parseOptions(recurrence.rule)
  if (!options) return '不正な繰り返し'

  const interval = options.interval ?? 1
  const freq = options.freq ?? -1

  if (recurrence.basis === 'completion') {
    return `完了の${interval}${INTERVAL_UNITS[freq] ?? ''}後`
  }

  const parts: string[] = []
  parts.push(
    interval === 1
      ? `毎${EVERY_UNITS[freq] ?? ''}`
      : `${interval}${INTERVAL_UNITS[freq] ?? ''}ごと`,
  )

  const weekdays = toArray(options.byweekday)
    .map((day) => WEEKDAY_LABELS[weekdayIndex(day)])
    .filter(Boolean)
  if (weekdays.length) parts.push(`${weekdays.join('・')}曜`)

  const monthDays = toArray(options.bymonthday)
  if (monthDays.length) parts.push(`${monthDays.join('・')}日`)

  if (options.count) parts.push(`（${options.count}回まで）`)
  if (options.until) {
    const until = options.until
    parts.push(
      `（${until.getFullYear()}/${until.getMonth() + 1}/${until.getDate()} まで）`,
    )
  }

  return parts.join(' ')
}

/**
 * byweekday は数値・Weekday オブジェクト・`"MO"` 形式のいずれでも返るため、
 * 0=月曜 の添字にそろえる。
 */
function weekdayIndex(day: number | { weekday: number } | string): number {
  if (typeof day === 'number') return day
  if (typeof day === 'string') return WEEKDAY_CODES.indexOf(day.toUpperCase())
  return day.weekday
}

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** rrule のオプションは単数と配列のどちらでも返るのでそろえる。 */
function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** 「毎◯」の形で使う単位。 */
const EVERY_UNITS: Record<number, string> = {
  [RRule.DAILY]: '日',
  [RRule.WEEKLY]: '週',
  [RRule.MONTHLY]: '月',
  [RRule.YEARLY]: '年',
}

/** 「2◯ごと」「完了の3◯後」の形で使う単位。 */
const INTERVAL_UNITS: Record<number, string> = {
  [RRule.DAILY]: '日',
  [RRule.WEEKLY]: '週間',
  [RRule.MONTHLY]: 'ヶ月',
  [RRule.YEARLY]: '年',
}

const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日']

/** 設定 UI に出す候補。よく使うものだけを並べる。 */
export const RECURRENCE_PRESETS: { label: string; input: string }[] = [
  { label: '毎日', input: '毎日' },
  { label: '毎週', input: '毎週' },
  { label: '隔週', input: '隔週' },
  { label: '毎月', input: '毎月' },
  { label: '毎年', input: '毎年' },
  { label: '完了の3日後', input: '完了の3日後' },
  { label: '完了の1週間後', input: '完了の1週間後' },
]
