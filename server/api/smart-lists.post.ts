import { useDb } from '~~/server/db'
import { smartLists } from '~~/server/db/schema'
import { toSmartListDto } from '~~/server/utils/smart-lists'
import { toSmartListInput, type SmartListDto } from '~~/shared/types/smart-list'

/** スマートリストを作る。中身の決まりは shared/types/smart-list.ts に置く。 */
export default defineEventHandler(async (event): Promise<SmartListDto> => {
  const input = toSmartListInput(await readBody(event) ?? {})
  if (!input) {
    throw createError({ statusCode: 400, message: 'リストの内容が正しくありません' })
  }

  const [row] = await useDb().insert(smartLists).values(input).returning()
  return toSmartListDto(row!)
})
