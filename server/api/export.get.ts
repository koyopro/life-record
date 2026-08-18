import { asc } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries, items, sections } from '~~/server/db/schema'
import {
  compareSectionsForDisplay,
  toItemDto,
  toSectionDto,
} from '~~/server/utils/items'
import { tagsByItemId } from '~~/server/utils/tags'
import { formatAppDate, toAppDate } from '~~/shared/utils/date'
import type { ItemDetailDto } from '~~/shared/types/item'
import { STATUS_LABELS } from '~~/shared/types/item'

/**
 * 全データの書き出し（docs/05-operations.md 5.3）。
 *
 * サービスから離れられる状態を保つための機能なので、
 * 中身は素直な JSON とプレーンテキストにする。
 *
 * - `json` … 構造をそのまま。読み込み直せる
 * - `text` … 日付ごとに読める形。Scrapbox 記法のまま持ち出せる
 *
 * 画像は本文のパス（`/images/...`）として残る。実体は S3 から
 * 別途取得する（バケットごとコピーすればよい）。
 */
export default defineEventHandler(async (event) => {
  const format = getQuery(event).format === 'text' ? 'text' : 'json'
  const db = useDb()

  const [itemRows, sectionRows, diaryRows] = await Promise.all([
    db.select().from(items).orderBy(asc(items.createdAt)),
    db.select().from(sections),
    db.select().from(diaries).orderBy(asc(diaries.date)),
  ])

  const tagNames = await tagsByItemId(
    db,
    itemRows.map((row) => row.id),
  )

  const byItemId = new Map<string, typeof sectionRows>()
  for (const row of sectionRows) {
    const list = byItemId.get(row.itemId)
    if (list) list.push(row)
    else byItemId.set(row.itemId, [row])
  }

  const exportedItems: ItemDetailDto[] = itemRows.map((row) => {
    const own = [...(byItemId.get(row.id) ?? [])].sort(compareSectionsForDisplay)
    // 本文は最初に作られた記録（docs/02-data-model.md 2.4）
    const primary = [...own].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0]

    return {
      ...toItemDto(row, primary?.body ?? null, tagNames.get(row.id) ?? []),
      sections: own.map(toSectionDto),
      primarySectionId: primary?.id ?? null,
    }
  })

  const stamp = toAppDate()

  if (format === 'text') {
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    setResponseHeader(
      event,
      'Content-Disposition',
      `attachment; filename="datalake-${stamp}.txt"`,
    )
    return toText(exportedItems, diaryRows)
  }

  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(
    event,
    'Content-Disposition',
    `attachment; filename="datalake-${stamp}.json"`,
  )

  return {
    exportedAt: new Date().toISOString(),
    items: exportedItems,
    diaries: diaryRows.map((row) => ({ date: row.date, body: row.body })),
  }
})

/** 読める形の書き出し。本文は記法のまま置く。 */
function toText(
  exportedItems: ItemDetailDto[],
  diaryRows: { date: string; body: string }[],
): string {
  const parts: string[] = []

  parts.push('# タスク\n')
  for (const item of exportedItems) {
    const meta = [
      STATUS_LABELS[item.status],
      item.priority ? `重要度${item.priority}` : null,
      item.dueAt ? `期限 ${formatAppDate(toAppDate(new Date(item.dueAt)))}` : null,
      item.tags.length ? item.tags.map((name) => `#${name}`).join(' ') : null,
      item.url,
    ].filter(Boolean)

    parts.push(`## ${item.title}`)
    parts.push(meta.join(' / '))
    for (const section of item.sections) {
      parts.push('')
      parts.push(`### ${formatAppDate(section.date)}`)
      // 行頭の空白は階層なので残す。落とすのは末尾の空行だけ
      parts.push(section.body.replace(/\s+$/, ''))
    }
    parts.push('')
  }

  parts.push('\n# 日記\n')
  for (const diary of diaryRows) {
    parts.push(`## ${formatAppDate(diary.date)}`)
    parts.push(diary.body.replace(/\s+$/, ''))
    parts.push('')
  }

  return parts.join('\n')
}
