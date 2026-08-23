import { asc } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { settings } from '~~/server/db/schema'
import type { SettingsDto } from '~~/shared/types/setting'

/**
 * 画面の設定（docs/15-client-state.md 14.7）。
 *
 * 件数は数個なので、絞り込まずまとめて返す。使う側が要る鍵だけを見る。
 */
export default defineEventHandler(async (): Promise<SettingsDto> => {
  const rows = await useDb()
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .orderBy(asc(settings.key))

  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
})
