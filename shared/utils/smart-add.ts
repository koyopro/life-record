import * as chrono from 'chrono-node'
import { isPriority, type Priority } from '../types/item'
import { normalizeTagName } from '../types/tag'
import type { Recurrence } from '../types/recurrence'
import { describeRecurrence, parseRecurrence } from './recurrence'
import { splitInput } from './text'

/**
 * SmartAdd（docs/08-todo-management.md 8.5）。
 *
 * 1行のテキストから、タイトル・期限・重要度をまとめて解釈する。
 * サーバー（作成時）とクライアント（入力中のプレビュー）で同じ結果に
 * なるよう、ロジックはこのファイルに集約する。
 */

export interface SmartAddResult {
  title: string
  dueAt: Date | null
  /** 期限に時刻の指定があったか。false なら日付のみ。 */
  dueHasTime: boolean
  /**
   * `^なし` / `^x` で、期限を明示的に「なし」にしたか。
   *
   * 期限を書かなかった場合は既定で今日になる（8.5）が、これはその既定を
   * 打ち消す指定。`dueAt` はどちらも null になるため、区別にはこちらを見る。
   */
  dueCleared: boolean
  priority: Priority | null
  /** 正規化済みのタグ名。 */
  tags: string[]
  /** 繰り返し。指定がなければ null。 */
  recurrence: Recurrence | null
  /**
   * 関連 URL。タイトルに裸の URL を書いた場合に取り込む。
   *
   * `Shift + u` で開く先になる。本文ではなく Item の属性として持つ。
   */
  url: string | null
  /** 解釈できなかった記法。UI で警告として出す。 */
  warnings: string[]
}

/**
 * 未対応の予約記号。
 *
 * 解釈せずタイトルの一部として残す。後から対応を追加しても、
 * 過去データの解釈が変わらないようにするため。
 * `@`（場所）と `=`（時間見積もり）は用途がないため対応しない。
 */
const RESERVED_SYMBOLS = ['@', '=']

/** 日付表現の終わりを示す記号。ここまでを chrono に渡す。 */
const TOKEN_BOUNDARY = /[!#*@=]/

export function parseSmartAdd(
  input: string,
  referenceDate: Date = new Date(),
): SmartAddResult {
  const warnings: string[] = []
  let rest = input.replace(/\r\n?/g, ' ').trim()

  const priorityResult = extractPriority(rest, warnings)
  rest = priorityResult.rest

  // 日付の解釈より先に取り除く。`^明日 #買い物` のように
  // 期限の後ろに続くタグを日付表現に混ぜないため。
  const tagResult = extractTags(rest, warnings)
  rest = tagResult.rest

  const recurrenceResult = extractRecurrence(rest, warnings)
  rest = recurrenceResult.rest

  const dueResult = extractDue(rest, referenceDate, warnings)
  rest = dueResult.rest

  const urlResult = extractUrl(rest)
  rest = urlResult.rest

  const title = rest.replace(/\s+/g, ' ').trim()

  return {
    title,
    dueAt: dueResult.dueAt,
    dueHasTime: dueResult.dueHasTime,
    dueCleared: dueResult.cleared,
    priority: priorityResult.priority,
    tags: tagResult.tags,
    recurrence: recurrenceResult.recurrence,
    url: urlResult.url,
    warnings,
  }
}

/** 期限の指定。日付と、時刻まで指定されているか。 */
export interface SmartAddDue {
  date: Date
  hasTime: boolean
}

/**
 * ボタンから選んだ内容。
 *
 * `undefined` はボタンを使っていないことを表し、その項目はテキストの
 * 記法に従う。`null` は「指定しない」を選んだことを表し、テキストに
 * 記法が書かれていても打ち消す。
 */
export interface SmartAddOverrides {
  due?: SmartAddDue | null
  priority?: Priority | null
  /** 付けるタグの全体。テキストに書かれた `#` はこれで置き換わる。 */
  tags?: string[]
  recurrence?: Recurrence | null
}

/** テキストの記法とボタンで選んだ内容を合わせた、いまの指定内容。 */
export interface SmartAddValues {
  due: SmartAddDue | null
  /**
   * 期限を明示的に「なし」にしたか（`^なし` / `^x`、または「期限を外す」）。
   * `due` はどちらの場合も null になるため、既定の「今日」を出すかはこちらで判断する。
   */
  dueCleared: boolean
  priority: Priority | null
  tags: string[]
  recurrence: Recurrence | null
}

/**
 * テキストの記法とボタンで選んだ内容を重ねる。ボタンが優先。
 *
 * 書き戻し（composeSmartAddInput）と、入力中の表示で同じ結果を使うために
 * ここに置く。テキストがまだ空でも、選んだ内容は表示に出したい。
 */
export function mergeSmartAddOverrides(
  parsed: SmartAddResult | null,
  overrides: SmartAddOverrides,
): SmartAddValues {
  const typedDue = parsed?.dueAt
    ? { date: parsed.dueAt, hasTime: parsed.dueHasTime }
    : null

  return {
    due: overrides.due !== undefined ? overrides.due : typedDue,
    dueCleared:
      overrides.due === null ||
      (overrides.due === undefined && Boolean(parsed?.dueCleared)),
    priority:
      overrides.priority !== undefined
        ? overrides.priority
        : (parsed?.priority ?? null),
    tags: overrides.tags ?? parsed?.tags ?? [],
    recurrence:
      overrides.recurrence !== undefined
        ? overrides.recurrence
        : (parsed?.recurrence ?? null),
  }
}

/**
 * ボタンで選んだ内容を、SmartAdd の記法としてテキストに書き戻す
 * （docs/08-todo-management.md 8.5）。
 *
 * スマートフォンでは記号を打つのが手間なので、期限や重要度をボタンから
 * 選べるようにしている。選んだ結果を Item へ渡す経路をテキストとは別に
 * 作ると、追加の経路（一覧の入力欄・共有の受付・オフラインの送信列・
 * サーバー）すべてに構造化した値を通すことになる。記法に書き戻せば、
 * これまでどおりテキスト1本のまま扱える。
 *
 * タイトルは `parseSmartAdd` が記法を取り除いたもの（`title`）から
 * 組み立て直す。こうすると、テキストに書かれた記法とボタンで選んだ
 * 内容が二重にならない。何も選んでいなければ書き換えない。
 */
export function composeSmartAddInput(
  input: string,
  overrides: SmartAddOverrides,
  referenceDate: Date = new Date(),
): string {
  const untouched = Object.values(overrides).every(
    (value) => value === undefined,
  )
  if (untouched) return input

  const split = splitInput(input)
  if (!split) return input

  const parsed = parseSmartAdd(split.titleLine, referenceDate)
  const { due, dueCleared, priority, tags, recurrence } = mergeSmartAddOverrides(
    parsed,
    overrides,
  )

  const parts = [parsed.title]
  if (parsed.url) parts.push(parsed.url)
  if (priority) parts.push(`!${priority}`)
  if (due) parts.push(`^${formatDueExpression(due)}`)
  // 期限の既定（今日）を打ち消す指定は、書き戻さないと消えてしまう
  else if (dueCleared) parts.push('^なし')
  for (const tag of tags) parts.push(`#${tag}`)
  // 繰り返しは空白を含む（「毎週 月曜」）ので、他の記号より後ろに置く
  if (recurrence) parts.push(`*${describeRecurrence(recurrence)}`)

  const titleLine = parts.filter(Boolean).join(' ')
  return split.body ? `${titleLine}\n${split.body}` : titleLine
}

/**
 * 期限を、`^` の後ろに書ける形にする。
 *
 * 「明日」のような相対表現ではなく絶対表記にする。書き戻したテキストを
 * 保存するのは送信時なので、日付をまたいでも指すものが変わらないように。
 */
function formatDueExpression(due: SmartAddDue): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${due.date.getFullYear()}/${pad(due.date.getMonth() + 1)}/${pad(due.date.getDate())}`
  if (!due.hasTime) return date
  return `${date} ${pad(due.date.getHours())}:${pad(due.date.getMinutes())}`
}

/**
 * 裸の URL を取り出して、Item の URL 欄に回す。
 *
 * タイトルに URL がそのまま入っていると読みにくく、
 * 一覧から開く導線もない。最初の1つだけを取り込む。
 */
function extractUrl(input: string): { rest: string; url: string | null } {
  const match = /(^|\s)(https?:\/\/\S+)/.exec(input)
  if (!match) return { rest: input, url: null }

  const url = match[2]!
  const start = match.index + match[1]!.length
  return {
    rest: `${input.slice(0, start)} ${input.slice(start + url.length)}`,
    url,
  }
}

/**
 * `*every week` のような繰り返し指定を取り出す（docs/10-recurrence.md 10.7）。
 *
 * 日付表現と違い、間に空白を含む（`every 2 weeks`）ため、
 * 次の記号または文字列の末尾までをまとめて渡す。
 */
function extractRecurrence(input: string, warnings: string[]) {
  const star = input.indexOf('*')
  if (star === -1) return { rest: input, recurrence: null }

  const after = input.slice(star + 1)
  const boundary = after.search(/[!^#@=]/)
  const candidate = (boundary === -1 ? after : after.slice(0, boundary)).trim()

  if (!candidate) {
    warnings.push('* の後ろに繰り返しが書かれていません')
    return { rest: removeAt(input, star, 1), recurrence: null }
  }

  const recurrence = parseRecurrence(candidate)
  if (!recurrence) {
    warnings.push(`「${candidate}」を繰り返しとして解釈できませんでした`)
    return { rest: removeAt(input, star, 1), recurrence: null }
  }

  const consumed = boundary === -1 ? after.length : boundary
  return {
    rest: removeAt(input, star, 1 + consumed),
    recurrence,
  }
}

/**
 * `#買い物` のようなタグ指定を取り出す（docs/09-tags.md 9.4）。
 *
 * RTM では `#` がリストとタグの両方に使われるが、このサービスに
 * リストの概念はないため常にタグとして解釈する。
 */
function extractTags(input: string, warnings: string[]) {
  const tags: string[] = []

  const rest = input.replace(/#([^\s,#]+)/g, (token, raw: string) => {
    const name = normalizeTagName(raw)
    if (!name) {
      warnings.push(`「${token}」はタグ名として使えません`)
      return token
    }
    if (!tags.includes(name)) tags.push(name)
    return ' '
  })

  return { rest, tags }
}

/**
 * `!1` / `!2` / `!3` を重要度として取り出す。`!4` は重要度なしの明示。
 *
 * 複数書かれた場合は最後のものを採用する（打ち間違いの上書きを許す）。
 */
function extractPriority(input: string, warnings: string[]) {
  let priority: Priority | null = null
  let matched = false

  const rest = input.replace(/!(\d+)/g, (token, digits) => {
    const value = Number(digits)
    if (isPriority(value)) {
      priority = value
      matched = true
      return ' '
    }
    if (value === 4) {
      // RTM の `4` と同じく「重要度なし」
      priority = null
      matched = true
      return ' '
    }
    warnings.push(`重要度は !1〜!3 で指定してください（${token} は無視しました）`)
    return token
  })

  return { rest: matched ? rest : input, priority }
}

/**
 * `^なし` / `^x` ＝ 期限を明示的に「なし」にする。
 *
 * 期限を書かなかった場合の既定（今日、8.5「期限を書かなかった場合」）を
 * 打ち消すための指定。RTM の `!4`（重要度なしの明示）と同じ考え方。
 */
const NO_DUE_PATTERN = /^(なし|x)$/i

/**
 * `^` に続く自然言語の日付表現を取り出す。
 *
 * 日本語・英語の両方を受け付ける。`^` の後ろから次の記号までを
 * chrono に渡し、実際に日付として解釈できた範囲だけを取り除く。
 * 解釈できなかった場合は警告を出し、テキストはタイトルに残す。
 */
function extractDue(
  input: string,
  referenceDate: Date,
  warnings: string[],
): { rest: string; dueAt: Date | null; dueHasTime: boolean; cleared: boolean } {
  const caret = input.indexOf('^')
  if (caret === -1) {
    return { rest: input, dueAt: null, dueHasTime: false, cleared: false }
  }

  const after = input.slice(caret + 1)
  const boundary = after.search(TOKEN_BOUNDARY)
  const candidate = (boundary === -1 ? after : after.slice(0, boundary)).trim()

  if (!candidate) {
    warnings.push('^ の後ろに日付が書かれていません')
    return {
      rest: removeAt(input, caret, 1),
      dueAt: null,
      dueHasTime: false,
      cleared: false,
    }
  }

  const leadingSpaces = after.length - after.trimStart().length

  if (NO_DUE_PATTERN.test(candidate)) {
    const rest = removeAt(input, caret, 1 + leadingSpaces + candidate.length)
    return { rest, dueAt: null, dueHasTime: false, cleared: true }
  }

  const parsed = parseDate(candidate, referenceDate)
  if (!parsed) {
    warnings.push(`「${candidate}」を日付として解釈できませんでした`)
    return {
      rest: removeAt(input, caret, 1),
      dueAt: null,
      dueHasTime: false,
      cleared: false,
    }
  }

  // `^` と、日付として解釈できた範囲だけを取り除く。
  // 「^明日 牛乳を買う」のように後ろに続く語はタイトルに残す。
  const rest = removeAt(input, caret, 1 + leadingSpaces + parsed.consumed)

  return { rest, dueAt: parsed.date, dueHasTime: parsed.hasTime, cleared: false }
}

function removeAt(input: string, index: number, length: number): string {
  return `${input.slice(0, index)} ${input.slice(index + length)}`
}

/** {@link parseDueExpression} の結果。 */
export type DueExpression =
  | { cleared: false; date: Date; hasTime: boolean }
  | { cleared: true }
  | null

/**
 * 自然言語の日付表現を解釈する。日本語 → 英語の順に試す。
 *
 * SmartAdd の `^` だけでなく、期限設定ダイアログ（`d`）でも使う。
 * `なし` / `x` は SmartAdd の `^なし` / `^x` と同じく「期限なし」の
 * 明示（NO_DUE_PATTERN）。覚えることを増やさないよう、両方で同じ書き方を使う。
 */
export function parseDueExpression(
  text: string,
  referenceDate: Date = new Date(),
): DueExpression {
  const trimmed = text.trim()
  if (NO_DUE_PATTERN.test(trimmed)) return { cleared: true }

  const parsed = parseDate(trimmed, referenceDate)
  return parsed ? { cleared: false, date: parsed.date, hasTime: parsed.hasTime } : null
}

/**
 * 「来週の水曜」のような、基準週・基準月をずらす前置詞。
 *
 * chrono はこの前置詞を読み飛ばして後ろの「水曜」だけを拾ってしまい、
 * 黙って今週の水曜を返す。誤った日付が入るほうが害が大きいので、
 * 前置詞を先に処理して基準日をずらしてから chrono に渡す。
 */
const SHIFT_PREFIXES: {
  pattern: RegExp
  /** 後ろに語が続くときの基準日。週や月の頭にそろえる。 */
  scopeStart: (ref: Date) => Date
  /** 前置詞だけで終わるときの日付。 */
  alone: (ref: Date) => Date
}[] = [
  {
    pattern: /^再来週の?/,
    scopeStart: (ref) => startOfWeek(ref, 2),
    alone: (ref) => addDays(ref, 14),
  },
  {
    pattern: /^来週の?/,
    scopeStart: (ref) => startOfWeek(ref, 1),
    alone: (ref) => addDays(ref, 7),
  },
  {
    pattern: /^再来月の?/,
    scopeStart: (ref) => startOfMonth(ref, 2),
    alone: (ref) => addMonths(ref, 2),
  },
  {
    pattern: /^来月の?/,
    scopeStart: (ref) => startOfMonth(ref, 1),
    alone: (ref) => addMonths(ref, 1),
  },
  {
    pattern: /^来年の?/,
    scopeStart: (ref) => new Date(ref.getFullYear() + 1, 0, 1),
    alone: (ref) => addMonths(ref, 12),
  },
]

/**
 * chrono が解釈しない、日常的によく使う相対表現。
 *
 * 「月末」「週末」などは chrono の辞書にないが、期限の指定では頻出する。
 * 長いものから先に照合する。
 */
const RELATIVE_EXPRESSIONS: {
  pattern: RegExp
  resolve: (ref: Date) => Date
}[] = [
  { pattern: /^来月末/, resolve: (ref) => endOfMonth(addMonths(ref, 1)) },
  { pattern: /^今月末|^月末/, resolve: (ref) => endOfMonth(ref) },
  { pattern: /^来週末/, resolve: (ref) => nextWeekday(addDays(ref, 7), 6) },
  { pattern: /^今週末|^週末/, resolve: (ref) => nextWeekday(ref, 6) },
]

function addDays(base: Date, days: number): Date {
  const date = new Date(base)
  date.setDate(date.getDate() + days)
  return date
}

function addMonths(base: Date, months: number): Date {
  const date = new Date(base)
  date.setMonth(date.getMonth() + months)
  return date
}

function endOfMonth(base: Date): Date {
  // 翌月の0日目 = 当月の末日
  return new Date(base.getFullYear(), base.getMonth() + 1, 0)
}

function startOfMonth(base: Date, monthsAhead: number): Date {
  return new Date(base.getFullYear(), base.getMonth() + monthsAhead, 1)
}

/** 月曜を週の始まりとして、weeksAhead 週先の月曜。 */
function startOfWeek(base: Date, weeksAhead: number): Date {
  const daysSinceMonday = (base.getDay() + 6) % 7
  return addDays(base, -daysSinceMonday + weeksAhead * 7)
}

/** 指定の曜日のうち、基準日より後で最も近い日。 */
function nextWeekday(base: Date, weekday: number): Date {
  const diff = (weekday - base.getDay() + 7) % 7
  return addDays(base, diff === 0 ? 7 : diff)
}

/** 時刻の指定がなければ「その日いっぱい」として扱う（期限切れ判定のため）。 */
function endOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(23, 59, 0, 0)
  return copy
}

interface ParsedDate {
  date: Date
  hasTime: boolean
  /** 先頭から何文字を日付として消費したか。 */
  consumed: number
}

/**
 * 「15日」のような日付だけの指定を、基準月の日付として解釈する。
 *
 * 「来月の15日」のように、月が前置詞で決まっている場合にのみ使う。
 */
function parseDayInScope(text: string, scope: Date): ParsedDate | null {
  const match = /^\s*(\d{1,2})日?/.exec(text)
  if (!match?.[1]) return null

  const day = Number(match[1])
  const lastDay = endOfMonth(scope).getDate()
  if (day < 1 || day > lastDay) return null

  return {
    date: endOfDay(new Date(scope.getFullYear(), scope.getMonth(), day)),
    hasTime: false,
    consumed: match[0].length,
  }
}

function runChrono(text: string, referenceDate: Date): ParsedDate | null {
  for (const parser of [chrono.ja, chrono.en]) {
    const [result] = parser.parse(text, referenceDate, { forwardDate: true })
    if (!result) continue

    const hasTime =
      result.start.isCertain('hour') || result.start.isCertain('minute')

    return {
      date: hasTime ? result.start.date() : endOfDay(result.start.date()),
      hasTime,
      consumed: result.index + result.text.length,
    }
  }
  return null
}

/**
 * 自然言語の日付表現を解釈する。
 *
 * 1. 「来週の〜」などの前置詞で基準日をずらしてから chrono に渡す
 * 2. chrono（日本語 → 英語）
 * 3. chrono が知らない「月末」「週末」
 */
function parseDate(text: string, referenceDate: Date): ParsedDate | null {
  for (const { pattern, resolve } of RELATIVE_EXPRESSIONS) {
    const match = pattern.exec(text)
    if (match) {
      return {
        date: endOfDay(resolve(referenceDate)),
        hasTime: false,
        consumed: match[0].length,
      }
    }
  }

  for (const { pattern, scopeStart, alone } of SHIFT_PREFIXES) {
    const match = pattern.exec(text)
    if (!match) continue

    const prefix = match[0]
    const remainder = text.slice(prefix.length)

    if (remainder.trim()) {
      const scope = scopeStart(referenceDate)

      const parsed = runChrono(remainder, scope)
      if (parsed) {
        return { ...parsed, consumed: prefix.length + parsed.consumed }
      }

      // chrono は裸の「15日」を日付として扱わないため、自分で拾う
      const dayOfMonth = parseDayInScope(remainder, scope)
      if (dayOfMonth) {
        return { ...dayOfMonth, consumed: prefix.length + dayOfMonth.consumed }
      }
    }

    // 前置詞だけ、または後ろが日付として読めなかった場合
    return {
      date: endOfDay(alone(referenceDate)),
      hasTime: false,
      consumed: prefix.length,
    }
  }

  return runChrono(text, referenceDate)
}

/** 予約記号が含まれているか。UI での案内に使う。 */
export function containsReservedSymbol(input: string): boolean {
  return RESERVED_SYMBOLS.some((symbol) => input.includes(symbol))
}
