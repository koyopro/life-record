/**
 * `/api/export`（JSON）で書き出した内容を、DB へ取り込み直す。
 *
 * 使い方:
 *   npx tsx scripts/import-backup.ts <datalake-YYYYMMDD.json> [--dry-run]
 *
 * 書き出しは「サービスから離れられる状態を保つ」ための機能なので、
 * **読み込み直せて初めて意味を持つ**（docs/05-operations.md 5.3 / 5.4）。
 * 空の DB への復元にも、消してしまった1件を戻すのにも使える。
 *
 * 方針:
 * - **同じ内容を二度入れても結果が変わらない**（id・タグ名・日付で突き合わせる）。
 *   途中で失敗しても、直してもう一度流せばよい
 * - 突き合わせた既存の行は、**書き出し側の内容で上書きする**。復元は
 *   「書き出した時点の状態に戻すこと」なので、古い方を残すと目的を果たさない
 * - 書き出しに無いものは消さない。1件だけ戻したいときに、他が消えては困る
 * - タグは**名前**で突き合わせる（名前が一意。id は環境ごとに変わりうる）
 * - 画像の実体は入らない。S3 のバケットを別に複製する（5.2）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { useDb, type Executor } from '../server/db'
import { diaries, icons, items, itemTags, sections, tags } from '../server/db/schema'
import type { ExportData } from '../shared/types/export'
import type { ItemDetailDto } from '../shared/types/item'

interface Counts {
  items: number
  sections: number
  diaries: number
  tags: number
  icons: number
  itemTags: number
}

function parseArgs(argv: string[]): { file: string; dryRun: boolean } {
  const args = argv.filter((arg) => arg !== '--dry-run')
  const file = args[0]
  if (!file) {
    throw new Error('使い方: npx tsx scripts/import-backup.ts <export.json> [--dry-run]')
  }
  return { file: resolve(file), dryRun: argv.includes('--dry-run') }
}

/** 書き出しの形をしているか、入れる前に確かめる。 */
function readExport(file: string): ExportData {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<ExportData>

  if (!Array.isArray(data.items) || !Array.isArray(data.diaries)) {
    throw new Error('items / diaries が見つかりません。/api/export の JSON を渡してください')
  }

  return {
    exportedAt: data.exportedAt ?? '',
    items: data.items,
    diaries: data.diaries,
    // タグ・アイコンは後から書き出しに加えたもの。古い書き出しには無い
    tags: data.tags ?? [],
    icons: data.icons ?? [],
  }
}

function toItemRow(item: ItemDetailDto): typeof items.$inferInsert {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    url: item.url,
    dueAt: item.dueAt ? new Date(item.dueAt) : null,
    dueHasTime: item.dueHasTime,
    recurrenceRule: item.recurrenceRule,
    recurrenceBasis: item.recurrenceBasis,
    seriesId: item.seriesId,
    completedAt: item.completedAt ? new Date(item.completedAt) : null,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
  }
}

/** タグを名前で突き合わせ、名前 → id の対応を返す。色は書き出し側で上書きする。 */
async function restoreTags(db: Executor, data: ExportData): Promise<Map<string, string>> {
  const names = new Set<string>(data.tags.map((tag) => tag.name))
  // タグの一覧が無い古い書き出しでも、Item に付いている名前から作れる
  for (const item of data.items) for (const name of item.tags) names.add(name)
  if (names.size === 0) return new Map()

  const exported = new Map(data.tags.map((tag) => [tag.name, tag]))

  for (const name of names) {
    const tag = exported.get(name)
    const row = {
      name,
      color: tag?.color ?? null,
      // 作られた時刻も書き出し側に合わせる。id だけは名前で突き合わせる都合上、
      // 取り込んだ先のものになる（どこからも参照されないので支障はない）
      ...(tag?.createdAt ? { createdAt: new Date(tag.createdAt) } : {}),
    }
    await db.insert(tags).values(row).onConflictDoUpdate({ target: tags.name, set: row })
  }

  const rows = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(inArray(tags.name, [...names]))

  return new Map(rows.map((row) => [row.name, row.id]))
}

async function restore(db: Executor, data: ExportData): Promise<Counts> {
  const counts: Counts = { items: 0, sections: 0, diaries: 0, tags: 0, icons: 0, itemTags: 0 }

  const tagIds = await restoreTags(db, data)
  counts.tags = tagIds.size

  for (const item of data.items) {
    const row = toItemRow(item)
    await db
      .insert(items)
      .values(row)
      .onConflictDoUpdate({ target: items.id, set: row })
    counts.items += 1

    for (const section of item.sections) {
      const sectionRow = {
        id: section.id,
        itemId: item.id,
        date: section.date,
        body: section.body,
        position: section.position,
        createdAt: new Date(section.createdAt),
        updatedAt: new Date(section.updatedAt),
      }
      await db
        .insert(sections)
        .values(sectionRow)
        .onConflictDoUpdate({ target: sections.id, set: sectionRow })
      counts.sections += 1
    }

    /*
     * タグの付け直し。書き出した時点の状態に戻すため、いったん外してから
     * 付ける（書き出し後に付けたタグが残ると、戻したことにならない）。
     */
    await db.delete(itemTags).where(eq(itemTags.itemId, item.id))
    const links = item.tags
      .map((name) => tagIds.get(name))
      .filter((tagId): tagId is string => Boolean(tagId))
      .map((tagId) => ({ itemId: item.id, tagId }))
    if (links.length > 0) {
      await db.insert(itemTags).values(links).onConflictDoNothing()
      counts.itemTags += links.length
    }
  }

  for (const diary of data.diaries) {
    const row = {
      date: diary.date,
      body: diary.body,
      createdAt: diary.createdAt ? new Date(diary.createdAt) : new Date(),
      updatedAt: diary.updatedAt ? new Date(diary.updatedAt) : new Date(),
    }
    await db
      .insert(diaries)
      .values(row)
      .onConflictDoUpdate({ target: diaries.date, set: row })
    counts.diaries += 1
  }

  for (const icon of data.icons) {
    const row = {
      name: icon.name,
      path: icon.path,
      createdAt: new Date(icon.createdAt),
    }
    await db.insert(icons).values(row).onConflictDoUpdate({ target: icons.name, set: row })
    counts.icons += 1
  }

  return counts
}

async function main() {
  const { file, dryRun } = parseArgs(process.argv.slice(2))
  const data = readExport(file)

  const sectionCount = data.items.reduce((sum, item) => sum + item.sections.length, 0)
  console.log(`書き出し: ${data.exportedAt || '（日時不明）'}`)
  console.log(`  タスク: ${data.items.length}件`)
  console.log(`  作業記録: ${sectionCount}件`)
  console.log(`  日記: ${data.diaries.length}件`)
  console.log(`  タグ: ${data.tags.length}件`)
  console.log(`  アイコン: ${data.icons.length}件`)

  if (dryRun) {
    console.log('--dry-run のため、DBへの書き込みは行いません。')
    return
  }

  const counts = await useDb().transaction((tx) => restore(tx, data))

  console.log('取り込み完了')
  console.log(
    `  タスク ${counts.items} / 作業記録 ${counts.sections} / 日記 ${counts.diaries} / ` +
      `タグ ${counts.tags}（付け直し ${counts.itemTags}） / アイコン ${counts.icons}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
