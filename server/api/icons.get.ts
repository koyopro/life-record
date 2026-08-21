import { asc } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { icons } from '~~/server/db/schema'
import type { IconDto } from '~~/shared/types/icon'

/** 登録したアイコンの一覧。本文の表示と候補で使う。 */
export default defineEventHandler(async (): Promise<IconDto[]> => {
  return await useDb()
    .select({ id: icons.id, name: icons.name, path: icons.path })
    .from(icons)
    .orderBy(asc(icons.name))
})
