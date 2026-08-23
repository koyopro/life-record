import type { Diary, Icon, Item, Section, Tag } from '~~/server/db/schema'
import { compareSectionsForDisplay, toItemDto, toSectionDto } from '~~/server/utils/items'
import type { ExportData } from '~~/shared/types/export'
import type { ItemDetailDto } from '~~/shared/types/item'
import { STATUS_LABELS } from '~~/shared/types/item'
import { formatAppDate, toAppDate } from '~~/shared/utils/date'

/**
 * 書き出しの組み立て（docs/05-operations.md 5.3）。
 *
 * DB から引く部分（server/api/export.get.ts）と分けておく。何が入っていて
 * 何が抜けているかは**持ち出せるかどうかに直結する**ので、単体で確かめられる
 * ようにしておきたい。
 */

export interface ExportRows {
  items: Item[]
  sections: Section[]
  diaries: Diary[]
  tags: Tag[]
  icons: Icon[]
  /** Item ごとのタグ名（server/utils/tags.ts の tagsByItemId）。 */
  tagNames: Map<string, string[]>
}

export function buildExport(rows: ExportRows, exportedAt: Date): ExportData {
  const byItemId = new Map<string, Section[]>()
  for (const section of rows.sections) {
    const list = byItemId.get(section.itemId)
    if (list) list.push(section)
    else byItemId.set(section.itemId, [section])
  }

  const items: ItemDetailDto[] = rows.items.map((item) => {
    const own = [...(byItemId.get(item.id) ?? [])].sort(compareSectionsForDisplay)
    // 本文は最初に作られた記録（docs/02-data-model.md 2.4）
    const primary = [...own].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0]

    return {
      ...toItemDto(item, primary?.body ?? null, rows.tagNames.get(item.id) ?? []),
      sections: own.map(toSectionDto),
      primarySectionId: primary?.id ?? null,
    }
  })

  return {
    exportedAt: exportedAt.toISOString(),
    items,
    diaries: rows.diaries.map((diary) => ({
      date: diary.date,
      body: diary.body,
      createdAt: diary.createdAt.toISOString(),
      updatedAt: diary.updatedAt.toISOString(),
    })),
    tags: rows.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdAt: tag.createdAt.toISOString(),
    })),
    icons: rows.icons.map((icon) => ({
      id: icon.id,
      name: icon.name,
      path: icon.path,
      createdAt: icon.createdAt.toISOString(),
    })),
  }
}

/**
 * 読める形の書き出し。本文は記法のまま置く。
 *
 * 読み込み直すためのものではないので、id や日時は載せない。ただし
 * **アイコンの対応表だけは載せる**。本文に残る `:name:` が何の絵だったのか、
 * これが無いと分からなくなるため（画像は S3 側に残る）。
 */
export function toText(data: ExportData): string {
  const parts: string[] = []

  parts.push('# タスク\n')
  for (const item of data.items) {
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
  for (const diary of data.diaries) {
    parts.push(`## ${formatAppDate(diary.date)}`)
    parts.push(diary.body.replace(/\s+$/, ''))
    parts.push('')
  }

  if (data.icons.length > 0) {
    parts.push('\n# アイコン\n')
    parts.push('本文の `:name:` は、それぞれ次の画像を指す。')
    parts.push('')
    for (const icon of data.icons) parts.push(`- :${icon.name}: ${icon.path}`)
    parts.push('')
  }

  return parts.join('\n')
}
