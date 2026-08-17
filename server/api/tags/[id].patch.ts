import { and, eq, inArray, ne } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { itemTags, tags } from '~~/server/db/schema'
import { assertUuid } from '~~/server/utils/items'
import { normalizeTagName, type TagDto } from '~~/shared/types/tag'

/**
 * タグをリネームする。付いている全 Item に反映される。
 *
 * リネーム先の名前がすでに存在する場合は2つのタグを統合する。
 * 表記ゆれを直す操作では衝突が起きて当然なので、エラーにせず吸収する。
 */
export default defineEventHandler(async (event): Promise<TagDto> => {
  const id = assertUuid(getRouterParam(event, 'id'), 'タグID')
  const payload = await readBody<{ name?: unknown }>(event)

  const name = normalizeTagName(String(payload?.name ?? ''))
  if (!name) {
    throw createError({
      statusCode: 400,
      message: 'タグ名として使えません（空白・カンマ・# は使えません）',
    })
  }

  const db = useDb()

  return await db.transaction(async (tx) => {
    const [target] = await tx.select().from(tags).where(eq(tags.id, id))
    if (!target) {
      throw createError({ statusCode: 404, message: '見つかりません' })
    }

    const [existing] = await tx
      .select()
      .from(tags)
      .where(and(eq(tags.name, name), ne(tags.id, id)))

    if (!existing) {
      const [renamed] = await tx
        .update(tags)
        .set({ name })
        .where(eq(tags.id, id))
        .returning()

      return { id: renamed!.id, name: renamed!.name, count: await countFor(tx, id) }
    }

    // --- 統合 ---
    // 両方のタグが付いている Item は、付け替えると主キーが衝突する。
    // 先に古いほうの紐付けを消してから、残りを付け替える。
    const alreadyTagged = await tx
      .select({ itemId: itemTags.itemId })
      .from(itemTags)
      .where(eq(itemTags.tagId, existing.id))

    const alreadyIds = alreadyTagged.map((row) => row.itemId)
    if (alreadyIds.length > 0) {
      await tx
        .delete(itemTags)
        .where(
          and(eq(itemTags.tagId, id), inArray(itemTags.itemId, alreadyIds)),
        )
    }

    await tx
      .update(itemTags)
      .set({ tagId: existing.id })
      .where(eq(itemTags.tagId, id))

    await tx.delete(tags).where(eq(tags.id, id))

    return {
      id: existing.id,
      name: existing.name,
      count: await countFor(tx, existing.id),
    }
  })
})

type Tx = Parameters<Parameters<ReturnType<typeof useDb>['transaction']>[0]>[0]

async function countFor(tx: Tx, tagId: string): Promise<number> {
  const rows = await tx
    .select({ itemId: itemTags.itemId })
    .from(itemTags)
    .where(eq(itemTags.tagId, tagId))
  return rows.length
}
