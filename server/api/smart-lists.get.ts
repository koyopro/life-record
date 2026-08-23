import { asc } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { smartLists } from '~~/server/db/schema'
import { toSmartListDto } from '~~/server/utils/smart-lists'
import type { SmartListDto } from '~~/shared/types/smart-list'

/** スマートリストの一覧（docs/08-todo-management.md 8.6）。作った順に返す。 */
export default defineEventHandler(async (): Promise<SmartListDto[]> => {
  const rows = await useDb()
    .select()
    .from(smartLists)
    .orderBy(asc(smartLists.createdAt), asc(smartLists.id))

  return rows.map(toSmartListDto)
})
