import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { icons } from '~~/server/db/schema'
import { assertUuid } from '~~/server/utils/items'

/**
 * アイコンを削除する。
 *
 * 本文に書かれた `:name:` はそのまま残り、画像ではなく文字として出る
 * （docs/11-scrapbox-notation.md 11.8）。本文を書き換えには行かない。
 */
export default defineEventHandler(async (event) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'アイコンID')

  const deleted = await useDb()
    .delete(icons)
    .where(eq(icons.id, id))
    .returning({ id: icons.id })

  if (deleted.length === 0) {
    throw createError({ statusCode: 404, message: '見つかりません' })
  }

  setResponseStatus(event, 204)
  return null
})
