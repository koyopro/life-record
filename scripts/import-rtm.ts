/**
 * Remember The Milk のエクスポート JSON から、期限付きタスクを Item として取り込む。
 *
 * 使い方:
 *   npx tsx scripts/import-rtm.ts <export.json> [--dry-run] [--prune-trashed]
 *
 * `--prune-trashed` を付けると、**前に取り込んでしまったゴミ箱のタスク**を
 * DB から消す。Item の id は RTM の id から決まる（itemIdFor）ので、
 * この import で入れたものだけを狙って消せる。
 *
 * 変換方針（docs/02-data-model.md に対応させる）:
 * - **ゴミ箱のタスクは取り込まない。**RTM の書き出しにはゴミ箱の分も含まれる
 *   ため、消したはずのタスクが並んでしまう（isTrashed）。
 * - 期限（date_due）を持ち、かつ未完了（date_completed なし）のタスクのみを対象にする。
 *   完了済みのものは import しない。
 * - 対象は常に未完了のため、status は未着手（backlog）にする。
 * - タスクの notes（メモ）は、その Item の Section として取り込む
 *   （note.series_id と task.series_id が対応する）。
 * - RTM の繰り返し（task.repeat）は本アプリの recurrence_rule に取り込む。
 *   RTM のエクスポートに含まれる repeat は通常すでに RRULE 形式なのでそのまま使う。
 *   軽微な崩れ（末尾セミコロン等）は補正し、RRULE として解釈できない場合は
 *   自然言語表現（"every week" 等）として SmartAdd と同じパーサーでも試す
 *   （parseRtmRecurrence）。task.repeat_every（true: 期限日起点 / false: 完了日起点）を
 *   recurrence_basis（due / completion）に対応させる（docs/10-recurrence.md 10.1）。
 *   それでも解釈できない場合のみ、繰り返しを設定せず警告を出す
 *   （黙って単発の Item にはしない）。
 *   系列を束ねる series_id は、次回オカレンス生成時にアプリ側が
 *   自分自身の id から遅延生成するため、import 時点では設定しない
 *   （server/utils/recurrence.ts の createNextOccurrence と同じ扱い）。
 * - 再実行しても重複登録しないよう、Item/Section の id は
 *   RTM 側の id から決定的に (uuidv5 で) 生成する。
 * - タグの色（トップレベルの `tags` 配列、`background_color` / `foreground_color`）は、
 *   色を変えずにそのまま取り込む。本アプリの色見本（shared/types/tag.ts の
 *   TAG_COLORS）は RTM と同じ 24 色を持っているので、`background_color` の
 *   完全一致で対応する色見本が決まる（buildTagColorMap）。
 *   一致しない色のときだけ、一番近い色見本に丸める（nearestTagColor）。
 *   すでに色が付いているタグは、再importで上書きしない（アプリ側で選び直した色を
 *   尊重するため）。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { useDb, type Executor } from '../server/db'
import { items, itemTags, sections, tags } from '../server/db/schema'
import type { RecurrenceBasis } from '../shared/types/recurrence'
import {
  normalizeTagName,
  rtmTagColorFromHex,
  TAG_COLOR_SWATCHES,
  TAG_COLORS,
  type TagColor,
} from '../shared/types/tag'
import { toAppDate, todayDueAt } from '../shared/utils/date'
import { isValidRule, parseRecurrence } from '../shared/utils/recurrence'
import { TITLE_MAX_LENGTH } from '../shared/utils/text'

/** server/utils/tags.ts の ensureTags と同じ処理。Nuxt alias 経由の import を避けるため複製する。 */
async function ensureTags(db: Executor, names: string[]): Promise<Map<string, string>> {
  const normalized = [...new Set(names.map(normalizeTagName).filter(Boolean))] as string[]
  if (normalized.length === 0) return new Map()

  await db
    .insert(tags)
    .values(normalized.map((name) => ({ name })))
    .onConflictDoNothing({ target: tags.name })

  const rows = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(inArray(tags.name, normalized))

  return new Map(rows.map((row) => [row.name, row.id]))
}

interface RtmTask {
  id: string
  series_id: string
  name: string
  priority?: string
  date_created?: number
  date_added?: number
  date_modified?: number
  date_due?: number
  date_due_has_time?: boolean
  date_completed?: number
  url?: string
  tags?: string[]
  /** RFC 5545 の RRULE 文字列。繰り返しなしタスクでは null または省略。 */
  repeat?: string | null
  /** true: 期限日起点（every） / false: 完了日起点（after）。 */
  repeat_every?: boolean
}

interface RtmNote {
  id: string
  series_id: string
  date_created: number
  date_modified?: number
  title?: string
  content: string
}

/**
 * RTM のタグ本体（色などのタグ自体のプロパティ）。`id` がタグ名そのもの
 * （`task.tags` に出てくる文字列と同じ）。色を選んでいないタグには
 * `background_color` / `foreground_color` が無い。
 */
interface RtmTag {
  id: string
  background_color?: string
  foreground_color?: string
}

interface RtmExport {
  tasks: RtmTask[]
  notes: RtmNote[]
  tags?: RtmTag[]
}

/** このスクリプト専用の固定 namespace（uuidv5 生成用）。値に意味はない。 */
const NAMESPACE = '2b1f7a0e-2f7b-4a53-8c0e-9a7a9f8f9a10'

function uuidv5(namespace: string, name: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const nameBytes = Buffer.from(name, 'utf8')
  const hash = createHash('sha1')
    .update(Buffer.concat([nsBytes, nameBytes]))
    .digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const itemIdFor = (taskId: string) => uuidv5(NAMESPACE, `task:${taskId}`)
const sectionIdFor = (noteId: string) => uuidv5(NAMESPACE, `note:${noteId}`)

/**
 * ゴミ箱に入っているタスクを見分ける鍵。
 *
 * RTM の書き出しには**ゴミ箱のタスクも含まれる**。削除した時刻（または印）を
 * 持つものがそれだが、鍵の名前は書き出しによって揺れるため、それらしい名前を
 * まとめて見る。実際に見つかった鍵は取り込み時に出す（想定と違う名前だった
 * ときに気づけるように）。
 */
const TRASH_KEYS = [
  'date_deleted',
  'date_trashed',
  'deleted',
  'trashed',
  'is_deleted',
] as const

/** ゴミ箱と判断した鍵。ゴミ箱でなければ null。 */
function trashKeyOf(task: RtmTask): string | null {
  for (const key of TRASH_KEYS) {
    const value = (task as unknown as Record<string, unknown>)[key]
    if (value === true) return key
    if (typeof value === 'number' && value > 0) return key
    if (typeof value === 'string' && value.trim()) return key
  }
  return null
}

/** RTM は "P1"（高）〜"P3"（低）、優先度なしはキー自体が省略される。 */
function parsePriority(value: string | undefined): 1 | 2 | 3 | null {
  const match = /^P([1-3])$/.exec(value ?? '')
  return match ? (Number(match[1]) as 1 | 2 | 3) : null
}

/**
 * RTM の repeat を recurrence_rule / recurrence_basis に変換する。
 * 解釈できない場合は null を返し、呼び出し側で警告を出す（黙って単発にはしない）。
 *
 * repeat は通常すでに RRULE 形式だが、末尾のセミコロンなど軽微な崩れがある場合は
 * 補正してから解釈を試みる。それでも RRULE として解釈できない場合、RTM の古い
 * クライアント由来の自然文表現（"every week" 等）が repeat にそのまま残っている
 * ケースを想定し、SmartAdd と同じ自然言語パーサー（parseRecurrence）でも試す。
 */
function parseRtmRecurrence(
  task: RtmTask,
): { rule: string; basis: RecurrenceBasis } | null {
  const raw = task.repeat?.trim()
  if (!raw) return null

  // 末尾のセミコロン・余分な空白は rrule のパースを丸ごと失敗させるので落とす
  const sanitized = raw.replace(/;+$/, '').trim()
  if (sanitized && isValidRule(sanitized)) {
    return { rule: sanitized, basis: task.repeat_every ? 'due' : 'completion' }
  }

  const natural = parseRecurrence(raw)
  if (natural) return natural

  return null
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2
}

/**
 * RTM の16進色から、一番近い固定の色見本を選ぶ（総当たりで十分な件数のため）。
 *
 * RTM の 24 色をそのまま持っているので、通常はここまで来ずに完全一致で決まる。
 * RTM 側が色見本を増やした場合の受け皿。
 */
function nearestTagColor(hex: string): TagColor {
  return TAG_COLORS.reduce((best, candidate) =>
    colorDistance(hex, TAG_COLOR_SWATCHES[candidate].background) <
    colorDistance(hex, TAG_COLOR_SWATCHES[best].background)
      ? candidate
      : best,
  )
}

/**
 * RTM のタグ配列から、タグ名 → 色見本 の対応表を作る。
 *
 * RTM のタグは色見本そのものを `background_color` に持ち、対になっている
 * 色が `foreground_color` に入る。本アプリは同じ 24 色を持っているので、
 * 背景色の完全一致でそのまま同じ色に移せる（丸めない）。
 * 色を持たないタグは、色を選んでいないタグ。
 */
function buildTagColorMap(rtmTags: RtmTag[] | undefined): Map<string, TagColor> {
  const map = new Map<string, TagColor>()
  for (const tag of rtmTags ?? []) {
    const name = normalizeTagName(tag.id)
    if (!name) continue

    const exact = tag.background_color ? rtmTagColorFromHex(tag.background_color) : null
    if (exact) {
      map.set(name, exact)
      continue
    }

    // 背景色が無い（か、知らない色）のときだけ、一番近い色見本に丸める。
    const hex = tag.background_color ?? tag.foreground_color
    if (!hex) continue
    map.set(name, nearestTagColor(hex.toLowerCase()))
  }
  return map
}

/**
 * まだ色が付いていないタグにだけ、RTM 由来の色を反映する。
 * アプリ側で選び直した色を、再importのたびに上書きしないようにするため。
 */
async function applyTagColors(
  tx: Executor,
  names: Set<string>,
  colors: Map<string, TagColor>,
): Promise<number> {
  const targets = [...names].filter((name) => colors.has(name))
  if (targets.length === 0) return 0

  const rows = await tx
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(inArray(tags.name, targets))

  let applied = 0
  for (const row of rows) {
    if (row.color) continue
    const color = colors.get(row.name)
    if (!color) continue
    await tx.update(tags).set({ color }).where(eq(tags.id, row.id))
    applied++
  }
  return applied
}

/**
 * 前に取り込んでしまったゴミ箱のタスクを消す（`--prune-trashed`）。
 *
 * Item の id は RTM の id から決まるので、この import で入れたものだけを
 * 狙って消せる。作業記録（Section）とタグの結び付きは外部キーで一緒に消える。
 */
async function pruneTrashed(
  trashedIds: string[],
  dryRun: boolean,
): Promise<void> {
  if (trashedIds.length === 0) return

  const db = useDb()
  const found = await db
    .select({ id: items.id, title: items.title })
    .from(items)
    .where(inArray(items.id, trashedIds))

  if (found.length === 0) {
    console.log('  取り込み済みのゴミ箱タスクはありませんでした。')
    return
  }

  console.log(`  取り込み済みのゴミ箱タスク: ${found.length}件`)
  for (const row of found) console.log(`    - ${row.title}`)

  if (dryRun) {
    console.log('  --dry-run のため、削除は行いません。')
    return
  }

  await db.delete(items).where(inArray(items.id, found.map((row) => row.id)))
  console.log(`  ${found.length}件を削除しました。`)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const prune = args.includes('--prune-trashed')
  const filePath = args.find((arg) => !arg.startsWith('--'))
  if (!filePath) {
    console.error(
      '使い方: npx tsx scripts/import-rtm.ts <export.json> [--dry-run] [--prune-trashed]',
    )
    process.exitCode = 1
    return
  }

  const raw = readFileSync(resolve(filePath), 'utf8')
  const data = JSON.parse(raw) as RtmExport

  // ゴミ箱のタスクは取り込まない（消したはずのものが並んでしまうため）
  const trashed = data.tasks.filter((task) => trashKeyOf(task) !== null)
  const trashKeys = [...new Set(trashed.map((task) => trashKeyOf(task)!))]

  const dueTasks = data.tasks.filter(
    (task) =>
      trashKeyOf(task) === null &&
      task.date_due != null &&
      task.date_completed == null,
  )

  console.log(`タスク総数: ${data.tasks.length}件 / 期限付き・未完了: ${dueTasks.length}件`)
  console.log(
    `  ゴミ箱として除外: ${trashed.length}件` +
      (trashKeys.length > 0 ? `（鍵: ${trashKeys.join(', ')}）` : ''),
  )

  if (prune) {
    await pruneTrashed(
      trashed.map((task) => itemIdFor(task.id)),
      dryRun,
    )
  }

  const notesBySeriesId = new Map<string, RtmNote[]>()
  for (const note of data.notes) {
    const list = notesBySeriesId.get(note.series_id) ?? []
    list.push(note)
    notesBySeriesId.set(note.series_id, list)
  }

  type PreparedItem = {
    item: typeof items.$inferInsert
    tagNames: string[]
    sectionRows: (typeof sections.$inferInsert)[]
  }

  const prepared: PreparedItem[] = []
  let skippedNoTitle = 0
  let recurringCount = 0
  let invalidRecurrenceCount = 0

  for (const task of dueTasks) {
    const title = task.name?.trim()
    if (!title) {
      skippedNoTitle++
      continue
    }

    const recurrence = parseRtmRecurrence(task)
    if (recurrence) {
      recurringCount++
    } else if (task.repeat?.trim()) {
      invalidRecurrenceCount++
      console.warn(
        `[警告] タスク "${title}" (id: ${task.id}) の repeat "${task.repeat}" を RRULE として解釈できないため、繰り返しなしで取り込みます。`,
      )
    }

    const dueHasTime = !!task.date_due_has_time
    const dueAt = dueHasTime
      ? new Date(task.date_due!)
      : todayDueAt(new Date(task.date_due!))
    const createdAt = new Date(task.date_created ?? task.date_added ?? task.date_due!)
    const updatedAt = new Date(task.date_modified ?? createdAt)
    const itemId = itemIdFor(task.id)

    const notes = [...(notesBySeriesId.get(task.series_id) ?? [])].sort(
      (a, b) => a.date_created - b.date_created,
    )

    const positionByDate = new Map<string, number>()
    const sectionRows = notes.map((note) => {
      const date = toAppDate(new Date(note.date_created))
      const position = positionByDate.get(date) ?? 0
      positionByDate.set(date, position + 1)
      const noteTitle = note.title?.trim()
      const body = noteTitle ? `${noteTitle}\n${note.content}` : note.content

      return {
        id: sectionIdFor(note.id),
        itemId,
        date,
        body,
        position,
        createdAt: new Date(note.date_created),
        updatedAt: new Date(note.date_modified ?? note.date_created),
      }
    })

    prepared.push({
      item: {
        id: itemId,
        title: title.slice(0, TITLE_MAX_LENGTH),
        status: 'backlog',
        priority: parsePriority(task.priority),
        url: task.url ?? null,
        dueAt,
        dueHasTime,
        recurrenceRule: recurrence?.rule ?? null,
        recurrenceBasis: recurrence?.basis ?? null,
        createdAt,
        updatedAt,
      },
      tagNames: task.tags ?? [],
      sectionRows,
    })
  }

  const totalSections = prepared.reduce((sum, p) => sum + p.sectionRows.length, 0)
  const tagColors = buildTagColorMap(data.tags)

  console.log(`import対象: ${prepared.length}件（タイトル欠落でスキップ: ${skippedNoTitle}件）`)
  console.log(`  メモから作る Section: ${totalSections}件`)
  console.log(
    `  繰り返しあり: ${recurringCount}件（RRULEとして解釈できず単発扱い: ${invalidRecurrenceCount}件）`,
  )
  console.log(`  色付きタグ: ${tagColors.size}件（RTMエクスポートの tags より）`)

  if (dryRun) {
    console.log('--dry-run のため、DBへの書き込みは行いません。')
    return
  }

  const db = useDb()
  const appliedColors = await db.transaction(async (tx) => {
    const touchedTagNames = new Set<string>()

    for (const { item, tagNames, sectionRows } of prepared) {
      await tx.insert(items).values(item).onConflictDoNothing()

      if (sectionRows.length > 0) {
        await tx.insert(sections).values(sectionRows).onConflictDoNothing()
      }

      if (tagNames.length > 0) {
        const tagIds = await ensureTags(tx, tagNames)
        if (tagIds.size > 0) {
          await tx
            .insert(itemTags)
            .values([...tagIds.values()].map((tagId) => ({ itemId: item.id!, tagId })))
            .onConflictDoNothing()
        }
        for (const name of tagIds.keys()) touchedTagNames.add(name)
      }
    }

    return await applyTagColors(tx, touchedTagNames, tagColors)
  })

  console.log(`  タグに色を設定: ${appliedColors}件（すでに色が付いているものは上書きしない）`)
  console.log('import完了')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
