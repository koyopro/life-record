import { and, eq, inArray, ne } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { itemTags, tags } from '~~/server/db/schema'
import { assertUuid } from '~~/server/utils/items'
import { isTagColor, normalizeTagName, type TagColor, type TagDto } from '~~/shared/types/tag'

interface Body {
  name?: unknown
  color?: unknown
}

/**
 * タグを更新する（リネーム・色の変更）。付いている全 Item に反映される。
 *
 * リネーム先の名前がすでに存在する場合は2つのタグを統合する。
 * 表記ゆれを直す操作では衝突が起きて当然なので、エラーにせず吸収する。
 * 統合した場合、色は残ったほう（統合先）の値を引き継ぐ
 * （このリクエストで色も指定していれば、そちらで上書きする）。
 */
export default defineEventHandler(async (event): Promise<TagDto> => {
  const id = assertUuid(getRouterParam(event, 'id'), 'タグID')
  const payload = await readBody<Body>(event)

  const hasName = payload?.name !== undefined
  const hasColor = payload?.color !== undefined

  if (!hasName && !hasColor) {
    throw createError({ statusCode: 400, message: '変更内容がありません' })
  }

  const name = hasName ? normalizeTagName(String(payload.name)) : null
  if (hasName && !name) {
    throw createError({
      statusCode: 400,
      message: 'タグ名として使えません（空白・カンマ・# は使えません）',
    })
  }

  let color: TagColor | null = null
  if (hasColor) {
    if (payload.color !== null && !isTagColor(payload.color)) {
      throw createError({ statusCode: 400, message: '色の指定が不正です' })
    }
    color = payload.color === null ? null : payload.color
  }

  const db = useDb()

  return await db.transaction(async (tx) => {
    const [target] = await tx.select().from(tags).where(eq(tags.id, id))
    if (!target) {
      throw createError({ statusCode: 404, message: '見つかりません' })
    }

    let finalId = id

    if (name) {
      const [existing] = await tx
        .select()
        .from(tags)
        .where(and(eq(tags.name, name), ne(tags.id, id)))

      if (!existing) {
        await tx.update(tags).set({ name }).where(eq(tags.id, id))
      } else {
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

        finalId = existing.id
      }
    }

    if (hasColor) {
      await tx.update(tags).set({ color }).where(eq(tags.id, finalId))
    }

    const [row] = await tx.select().from(tags).where(eq(tags.id, finalId))
    return { id: row!.id, name: row!.name, color: row!.color, count: await countFor(tx, finalId) }
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
