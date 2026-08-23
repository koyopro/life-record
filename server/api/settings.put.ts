import { asc, sql } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { settings } from '~~/server/db/schema'
import {
  SETTING_KEYS_MAX,
  SETTING_KEY_MAX_LENGTH,
  SETTING_VALUE_MAX_LENGTH,
  type SettingsDto,
} from '~~/shared/types/setting'

/**
 * 設定を保存する（送られてきた鍵だけを上書きする）。
 *
 * 後から書いたものが残る（競合の確認はしない）。「どう見せるか」だけを
 * 持つので、食い違っても最後に選んだ見え方になれば足りるため。
 */
export default defineEventHandler(async (event): Promise<SettingsDto> => {
  const payload = await readBody<Record<string, unknown>>(event)
  const entries = Object.entries(payload ?? {})

  if (entries.length === 0 || entries.length > SETTING_KEYS_MAX) {
    throw createError({ statusCode: 400, message: '設定が正しくありません' })
  }

  const rows = entries.map(([rawKey, rawValue]) => {
    const key = rawKey.trim()
    const value = String(rawValue ?? '')
    if (
      !key ||
      key.length > SETTING_KEY_MAX_LENGTH ||
      value.length > SETTING_VALUE_MAX_LENGTH
    ) {
      throw createError({ statusCode: 400, message: '設定が正しくありません' })
    }
    return { key, value }
  })

  const db = useDb()

  await db
    .insert(settings)
    .values(rows)
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: sql`excluded.value`, updatedAt: sql`now()` },
    })

  const saved = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .orderBy(asc(settings.key))

  return Object.fromEntries(saved.map((row) => [row.key, row.value]))
})
