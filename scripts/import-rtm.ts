/**
 * Remember The Milk のエクスポート JSON から、期限付きタスクを Item として取り込む。
 *
 * 使い方:
 *   npx tsx scripts/import-rtm.ts <export.json> [--dry-run]
 *
 * 変換方針（docs/02-data-model.md に対応させる）:
 * - 期限（date_due）を持つタスクのみを対象にする。
 * - date_completed があれば closed、なければ backlog にする
 *   （「着手可能」の意味が、期限付きで残っているタスクに近いため）。
 * - タスクの notes（メモ）は、その Item の Section として取り込む
 *   （note.series_id と task.series_id が対応する）。
 * - RTM の繰り返し（repeat）はこのスクリプトでは取り込まない。
 *   RTM と本アプリで繰り返しの意味（every/after の判定条件）が異なり、
 *   安全に変換できないため、単発の Item として登録する。
 * - 再実行しても重複登録しないよう、Item/Section の id は
 *   RTM 側の id から決定的に (uuidv5 で) 生成する。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inArray } from 'drizzle-orm'
import { useDb, type Executor } from '../server/db'
import { items, itemTags, sections, tags } from '../server/db/schema'
import { normalizeTagName } from '../shared/types/tag'
import type { ItemStatus } from '../shared/types/item'
import { toAppDate, todayDueAt } from '../shared/utils/date'
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
}

interface RtmNote {
  id: string
  series_id: string
  date_created: number
  date_modified?: number
  title?: string
  content: string
}

interface RtmExport {
  tasks: RtmTask[]
  notes: RtmNote[]
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

/** RTM は "P1"（高）〜"P3"（低）、優先度なしはキー自体が省略される。 */
function parsePriority(value: string | undefined): 1 | 2 | 3 | null {
  const match = /^P([1-3])$/.exec(value ?? '')
  return match ? (Number(match[1]) as 1 | 2 | 3) : null
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const filePath = args.find((arg) => !arg.startsWith('--'))
  if (!filePath) {
    console.error('使い方: npx tsx scripts/import-rtm.ts <export.json> [--dry-run]')
    process.exitCode = 1
    return
  }

  const raw = readFileSync(resolve(filePath), 'utf8')
  const data = JSON.parse(raw) as RtmExport

  const dueTasks = data.tasks.filter((task) => task.date_due != null)
  console.log(`タスク総数: ${data.tasks.length}件 / 期限付き: ${dueTasks.length}件`)

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

  for (const task of dueTasks) {
    const title = task.name?.trim()
    if (!title) {
      skippedNoTitle++
      continue
    }

    const dueHasTime = !!task.date_due_has_time
    const dueAt = dueHasTime
      ? new Date(task.date_due!)
      : todayDueAt(new Date(task.date_due!))
    const completedAt = task.date_completed ? new Date(task.date_completed) : null
    const status: ItemStatus = completedAt ? 'closed' : 'backlog'
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
        status,
        priority: parsePriority(task.priority),
        url: task.url ?? null,
        dueAt,
        dueHasTime,
        completedAt,
        createdAt,
        updatedAt,
      },
      tagNames: task.tags ?? [],
      sectionRows,
    })
  }

  const closedCount = prepared.filter((p) => p.item.status === 'closed').length
  const totalSections = prepared.reduce((sum, p) => sum + p.sectionRows.length, 0)

  console.log(`import対象: ${prepared.length}件（タイトル欠落でスキップ: ${skippedNoTitle}件）`)
  console.log(
    `  完了済み(closed): ${closedCount}件 / 未完了(backlog): ${prepared.length - closedCount}件`,
  )
  console.log(`  メモから作る Section: ${totalSections}件`)

  if (dryRun) {
    console.log('--dry-run のため、DBへの書き込みは行いません。')
    return
  }

  const db = useDb()
  await db.transaction(async (tx) => {
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
      }
    }
  })

  console.log('import完了')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
