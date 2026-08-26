import {
  composeSmartAddInput,
  parseDueExpression,
  parseSmartAdd,
  type SmartAddDue,
  type SmartAddOverrides,
} from './smart-add'
import { splitInput } from './text'
import { toAppDate } from './date'
import type { DueCondition } from '../types/smart-list'

/**
 * スマートリストの期限条件に当てはまるか（docs/08-todo-management.md 8.6）。
 *
 * 一覧を作るところ（`useItemList`）と、袖に出す件数（`app/utils/list-count.ts`）の
 * 両方から使う。別々に書くと数字と中身がずれる。
 */

/**
 * 比べるのは**日付だけ**（アプリのタイムゾーン）。
 *
 * 期限は時刻まで持てるが、「金曜以内」と決めた条件が金曜の何時かで
 * 当たり外れを変えるのは意図と違う。時刻の指定がない期限は 23:59 で
 * 保存されている（docs/08-todo-management.md 8.5）ので、時刻まで見ると
 * 「その日と等しい」がほとんど当たらなくなる、という事情もある。
 *
 * 判定は `useItemList` の「今日」（期限が今日の終わりまで）と同じ結果になる
 * ＝ `dueAt <= endOfAppDay()` は `toAppDate(dueAt) <= 今日` と同じ。
 */
export function matchesDue(
  dueAt: string | null,
  condition: DueCondition | null,
  now: Date = new Date(),
): boolean {
  if (!condition) return true

  if (condition.operator === 'unset') return dueAt === null
  if (condition.operator === 'set') return dueAt !== null

  // 期限を決めていないものは、日付での絞り込みには当てはまらない
  if (!dueAt) return false

  const target = resolveDueDate(condition.value, now)
  // 読めない式（手で書き換えた・記法を変えた）では絞り込まない。
  // 1つの条件のせいでリストが空になるより、絞らずに開けるほうがよい
  if (!target) return true

  const date = toAppDate(new Date(dueAt))

  switch (condition.operator) {
    case 'within':
      return date <= target
    case 'on':
      return date === target
    case 'before':
      return date < target
    case 'after':
      return date >= target
  }
}

/** 式（`今日` `金曜` `来週`…）を、その時点のアプリ日付にする。読めなければ null。 */
export function resolveDueDate(value: string, now: Date = new Date()): string | null {
  const parsed = parseDueExpression(value, now)
  if (!parsed || parsed.cleared) return null
  return toAppDate(parsed.date)
}

/**
 * スマートリストからの追加に、そのリストの条件を既定として足す。
 *
 * そのまま追加すると条件から外れ、**追加した途端に一覧から消える**。
 * タスク一覧でタグ絞り込み中に追加するときと同じ扱い（`withTagDefaults`）を、
 * 期限の条件にも広げる。
 *
 * 期限を埋めるのは「以内」「と等しい」「期限なし」のときだけ。「より前」
 * 「以降」「期限あり」は、どの日を入れれば当てはまるのかが1つに決まらず、
 * 勝手に決めると書いていない期限が入ってしまう。
 *
 * 明示的に書かれた指定（`#別タグ` や `^明日`）は上書きしない。
 */
export function withListDefaults(
  text: string,
  list: { tag: string | null; due: DueCondition | null } | null | undefined,
  now: Date = new Date(),
): string {
  if (!list || (!list.tag && !list.due)) return text

  const split = splitInput(text)
  if (!split) return text
  const parsed = parseSmartAdd(split.titleLine)

  const overrides: SmartAddOverrides = {}
  if (list.tag) overrides.tags = [...new Set([...parsed.tags, list.tag])]

  // 書かれていない期限だけを埋める
  if (parsed.dueAt === null && !parsed.dueCleared) {
    const preferred = defaultDueFor(list.due, now)
    /*
     * 決められないときは、タグと同じ扱いにする。書かなければ既定で「今日」に
     * なる（buildItemDraft）が、条件で絞って見ているときの追加は
     * 「今日やること」に限らないので「なし」に寄せる。
     */
    if (preferred !== 'none') overrides.due = preferred
    else if (list.tag) overrides.due = null
  }

  return composeSmartAddInput(text, overrides)
}

/**
 * その条件に当てはまる既定の期限。
 *
 * `null` は「期限なし」、`'none'` は「決められない（呼ぶ側に任せる）」。
 */
function defaultDueFor(
  due: DueCondition | null,
  now: Date,
): SmartAddDue | null | 'none' {
  if (!due) return 'none'
  if (due.operator === 'unset') return null
  if (due.operator !== 'within' && due.operator !== 'on') return 'none'

  // `^今日` と打ったのと同じ結果にする（覚えることを増やさないため）
  const parsed = parseDueExpression(due.value, now)
  if (!parsed || parsed.cleared) return 'none'
  return { date: parsed.date, hasTime: parsed.hasTime }
}
