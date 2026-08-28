// rrule は環境によって解決されるビルドが変わり、import の形を1つに決められない。
// - Nuxt の本番ビルド（Vite/Rollup）: ESM 版（named export のみ、default なし）
// - scripts/import-rtm.ts のような素の Node ESM 実行時（tsx）: CJS 版を interop 経由で
//   読むため、named export の静的検出ができず default 経由になる
// どちらの形でも読めるよう、名前空間 import からその場で拾う。
import * as rruleNamespace from 'rrule'
import type { RRule as RRuleType } from 'rrule'
import type { Recurrence, RecurrenceBasis } from '../types/recurrence'

const RRule: typeof RRuleType =
  (rruleNamespace as { RRule?: typeof RRuleType }).RRule ??
  (rruleNamespace as unknown as { default: { RRule: typeof RRuleType } }).default.RRule

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
 * 「平日」「週末」を曜日の組で表したもの（RTM の weekday / weekend）。
 *
 * 月の「最後の平日」のように、**どの曜日かではなく並びの何番目か**で決まる
 * 指定に使う。RRULE では曜日の組（BYDAY）と、その中の何番目か（BYSETPOS）で
 * 表す（`FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1`）。
 */
const WEEKDAY_GROUPS: { label: string; keywords: string[]; codes: string[] }[] = [
  {
    label: '平日',
    keywords: ['平日', '営業日', 'weekday'],
    codes: ['MO', 'TU', 'WE', 'TH', 'FR'],
  },
  { label: '週末', keywords: ['週末', 'weekend'], codes: ['SA', 'SU'] },
]

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
  // 「完了の」は省略可にする。「後」は due（毎〜）側では使わない語のため、
  // 「1日後」だけでも「完了の1日後」と同じ意味として受け付けて問題ない。
  const afterMatch =
    /^after\s+(?:(\d+)\s*)?(day|days|week|weeks|month|months|year|years)$/.exec(
      text,
    ) ?? /^(?:完了(?:の)?\s*)?(?:(\d+))?\s*(日|週間|週|月|年)後$/.exec(text)

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

  // 毎月の最後の平日 / 毎月の第2月曜 / 2ヶ月ごとの最後の金曜
  const ordinal = parseMonthlyOrdinal(text)
  if (ordinal) return ordinal

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

/**
 * 月の中の並びで決まる指定（`毎月の最後の平日` `毎月の第2月曜`）。
 *
 * RTM の「オン: 最後の・平日」に当たるもの。曜日を直に書く指定（`毎週月曜`）と
 * 違い、**その月の何番目か**で日が決まる。
 */
function parseMonthlyOrdinal(text: string): string | null {
  const match =
    /^(?:毎月|(\d+)\s*(?:ヶ|ケ|か|カ)?月ごと)の?(最後から\s*\d+\s*番目|最後|最終|最初|第\s*\d+|\d+\s*番目)の?(平日|営業日|週末|[月火水木金土日])(?:曜日?)?$/.exec(
      text,
    ) ??
    /^every\s+(?:(\d+)\s+months?|month)\s+on\s+the\s+(last|first|\d+(?:st|nd|rd|th)?)\s+(weekday|weekend|[a-z]+day|mon|tue|wed|thu|fri|sat|sun)$/.exec(
      text,
    )
  if (!match) return null

  const interval = match[1] ? Number(match[1]) : 1
  const position = toPosition(match[2]!)
  const codes = toWeekdayCodes(match[3]!)
  if (position === null || !codes) return null
  if (!Number.isInteger(interval) || interval < 1 || interval > 366) return null

  const parts = [`FREQ=MONTHLY`]
  if (interval > 1) parts.push(`INTERVAL=${interval}`)

  /*
   * 曜日が1つなら BYDAY に序数を付けた形（`BYDAY=-1MO`）にする。RFC 5545 の
   * 素直な書き方で、他のツールへ移したときにも読める。曜日が複数（平日・週末）
   * のときは、その組の中の何番目かなので BYSETPOS で表すしかない。
   */
  if (codes.length === 1) parts.push(`BYDAY=${position}${codes[0]}`)
  else parts.push(`BYDAY=${codes.join(',')}`, `BYSETPOS=${position}`)

  return parts.join(';')
}

/** 「最後」「第2」などを、RRULE の序数（-1 / 2）にする。読めなければ null。 */
function toPosition(text: string): number | null {
  const value = text.replace(/\s+/g, '')
  if (/^(最後|最終|last)$/.test(value)) return -1
  if (/^(最初|first|1st)$/.test(value)) return 1

  const fromEnd = /^最後から(\d+)番目$/.exec(value)
  if (fromEnd) return -Number(fromEnd[1])

  const nth = /^(?:第)?(\d+)(?:番目|st|nd|rd|th)?$/.exec(value)
  if (!nth) return null

  const number = Number(nth[1])
  // 月の中に同じ曜日は最大5回。それ以上は当たる月が無く、指定として意味を持たない
  return number >= 1 && number <= 5 ? number : null
}

/** 「平日」「月」などを BYDAY の曜日コードにする。読めなければ null。 */
function toWeekdayCodes(text: string): string[] | null {
  const group = WEEKDAY_GROUPS.find((entry) => entry.keywords.includes(text))
  if (group) return group.codes

  const day = WEEKDAYS[text]
  return day ? [day] : null
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

  /*
   * 月の中の並びで決まる指定（`毎月の最後の平日`）は、単位と曜日を別々に
   * 並べると意味が変わってしまう（「毎月 月・火・水・木・金曜」では、
   * どの週かが抜け落ちる）。ひとまとまりの言い方にする。
   */
  const ordinal = describeMonthlyOrdinal(options)
  if (ordinal) {
    parts.push(
      interval === 1 ? `毎月の${ordinal}` : `${interval}ヶ月ごとの${ordinal}`,
    )
  } else {
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
  }

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
 * 月の中の並びで決まる指定を日本語にする（`最後の平日` `第2月曜`）。
 * そういう指定でなければ null（＝ふつうの曜日・日付の指定）。
 *
 * 書き戻した文がそのまま `parseRecurrence` で読めるようにしておく。設定
 * ダイアログは、いまの設定をこの文にしてから入力欄へ入れるため、読めないと
 * 開き直しただけで設定を失う。
 */
function describeMonthlyOrdinal(
  options: ReturnType<typeof parseOptions>,
): string | null {
  if (!options || options.freq !== RRule.MONTHLY) return null

  const days = toArray(options.byweekday)
  if (days.length === 0) return null

  // 序数は BYSETPOS（曜日の組の中の何番目か）か、BYDAY 自身に付く（`-1MO`）
  const position = toArray(options.bysetpos)[0] ?? nthOf(days[0]!)
  if (!position) return null

  const codes = days.map((day) => WEEKDAY_CODES[weekdayIndex(day)])
  const group = WEEKDAY_GROUPS.find(
    (entry) =>
      entry.codes.length === codes.length &&
      entry.codes.every((code) => codes.includes(code)),
  )

  if (group) return `${positionLabel(position)}の${group.label}`
  if (days.length !== 1) return null

  const weekday = `${WEEKDAY_LABELS[weekdayIndex(days[0]!)]}曜`
  // 曜日は「第2月曜」、平日・週末は「2番目の平日」と言い分ける（RTM の言い方）
  return position > 0
    ? `第${position}${weekday}`
    : `${positionLabel(position)}の${weekday}`
}

/** 序数の言い方。`-1` は「最後」、`2` は「2番目」。 */
function positionLabel(position: number): string {
  if (position === -1) return '最後'
  if (position < -1) return `最後から${-position}番目`
  if (position === 1) return '最初'
  return `${position}番目`
}

/** BYDAY に付く序数（`-1MO` の -1）。持たない形なら undefined。 */
function nthOf(day: number | { n?: number } | string): number | undefined {
  return typeof day === 'object' ? (day.n ?? undefined) : undefined
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
  { label: '毎月の最後の平日', input: '毎月の最後の平日' },
  { label: '完了の3日後', input: '完了の3日後' },
  { label: '完了の1週間後', input: '完了の1週間後' },
]
