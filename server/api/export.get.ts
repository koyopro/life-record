import { asc } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { diaries, icons, items, sections, tags } from '~~/server/db/schema'
import { buildExport, toText } from '~~/server/utils/export'
import { tagsByItemId } from '~~/server/utils/tags'
import { toAppDate } from '~~/shared/utils/date'

/**
 * 全データの書き出し（docs/05-operations.md 5.3）。
 *
 * サービスから離れられる状態を保つための機能なので、
 * 中身は素直な JSON とプレーンテキストにする。
 *
 * - `json` … 構造をそのまま。`scripts/import-backup.ts` で読み込み直せる
 * - `text` … 日付ごとに読める形。Scrapbox 記法のまま持ち出せる
 *
 * **DB のユーザーデータはすべて入れる**（タスク・作業記録・日記・タグ・
 * アイコン）。組み立ては server/utils/export.ts。
 *
 * 画像は本文のパス（`/images/...`）として残る。実体は S3 から
 * 別途取得する（バケットごとコピーすればよい）。
 */
export default defineEventHandler(async (event) => {
  const format = getQuery(event).format === 'text' ? 'text' : 'json'
  const db = useDb()

  const [itemRows, sectionRows, diaryRows, tagRows, iconRows] = await Promise.all([
    db.select().from(items).orderBy(asc(items.createdAt)),
    db.select().from(sections),
    db.select().from(diaries).orderBy(asc(diaries.date)),
    db.select().from(tags).orderBy(asc(tags.name)),
    db.select().from(icons).orderBy(asc(icons.name)),
  ])

  const tagNames = await tagsByItemId(
    db,
    itemRows.map((row) => row.id),
  )

  const data = buildExport(
    {
      items: itemRows,
      sections: sectionRows,
      diaries: diaryRows,
      tags: tagRows,
      icons: iconRows,
      tagNames,
    },
    new Date(),
  )

  const stamp = toAppDate()

  if (format === 'text') {
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    setResponseHeader(
      event,
      'Content-Disposition',
      `attachment; filename="datalake-${stamp}.txt"`,
    )
    return toText(data)
  }

  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(
    event,
    'Content-Disposition',
    `attachment; filename="datalake-${stamp}.json"`,
  )

  return data
})
