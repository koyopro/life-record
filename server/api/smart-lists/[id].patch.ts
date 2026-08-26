import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { smartLists } from '~~/server/db/schema'
import { assertUuid } from '~~/server/utils/items'
import { toSmartListDto, toSmartListRow } from '~~/server/utils/smart-lists'
import { toSmartListInput, type SmartListDto } from '~~/shared/types/smart-list'

/**
 * スマートリストを更新する。中身は丸ごと差し替える。
 *
 * 項目が5つしかなく、画面でも1つのフォームとして編集するため、
 * 部分更新にする意味がない。並び・グループ順だけを変えるとき
 * （一覧の右上で選び直したとき）も、いまの内容を添えて送る。
 */
export default defineEventHandler(async (event): Promise<SmartListDto> => {
  const id = assertUuid(getRouterParam(event, 'id'), 'リストID')
  const input = toSmartListInput(await readBody(event) ?? {})
  if (!input) {
    throw createError({ statusCode: 400, message: 'リストの内容が正しくありません' })
  }

  const [row] = await useDb()
    .update(smartLists)
    .set(toSmartListRow(input))
    .where(eq(smartLists.id, id))
    .returning()

  if (!row) throw createError({ statusCode: 404, message: 'リストが見つかりません' })
  return toSmartListDto(row)
})
