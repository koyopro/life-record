import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { itemTags, items, tags } from '~~/server/db/schema'
import { assertUuid, toItemDtos } from '~~/server/utils/items'
import { ensureTags, pruneOrphanTags } from '~~/server/utils/tags'
import type { ItemDto } from '~~/shared/types/item'
import { normalizeTagName } from '~~/shared/types/tag'

interface Body {
  ids?: unknown
  /** 付けるタグ名。 */
  add?: unknown
  /** 外すタグ名。 */
  remove?: unknown
}

/**
 * 複数の Item に対してタグをまとめて付け外しする。
 *
 * 1件でも複数選択でも同じ経路で扱えるようにする
 * （docs/09-tags.md 9.3）。
 */
export default defineEventHandler(async (event): Promise<ItemDto[]> => {
  const payload = await readBody<Body>(event)

  if (!Array.isArray(payload?.ids) || payload.ids.length === 0) {
    throw createError({
      statusCode: 400,
      message: '対象が指定されていません',
    })
  }
  const ids = payload.ids.map((id) => assertUuid(id))

  const add = normalizeNames(payload.add, '付けるタグ')
  const remove = normalizeNames(payload.remove, '外すタグ')

  if (add.length === 0 && remove.length === 0) {
    throw createError({
      statusCode: 400,
      message: '変更内容がありません',
    })
  }

  const db = useDb()

  const updated = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: items.id })
      .from(items)
      .where(inArray(items.id, ids))

    if (existing.length === 0) {
      throw createError({ statusCode: 404, message: '見つかりません' })
    }
    const targetIds = existing.map((row) => row.id)

    if (add.length > 0) {
      const tagIds = await ensureTags(tx, add)
      const values = targetIds.flatMap((itemId) =>
        [...tagIds.values()].map((tagId) => ({ itemId, tagId })),
      )
      // すでに付いているものは無視する
      await tx.insert(itemTags).values(values).onConflictDoNothing()
    }

    if (remove.length > 0) {
      const removeIds = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(inArray(tags.name, remove))

      if (removeIds.length > 0) {
        await tx.delete(itemTags).where(
          and(
            inArray(itemTags.itemId, targetIds),
            inArray(
              itemTags.tagId,
              removeIds.map((row) => row.id),
            ),
          ),
        )
      }
    }

    // 参照がなくなったタグは残さない
    await pruneOrphanTags(tx)

    return await tx.select().from(items).where(inArray(items.id, targetIds))
  })

  return await toItemDtos(db, updated)
})

function normalizeNames(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      message: `${label}の指定が不正です`,
    })
  }

  const names: string[] = []
  for (const raw of value) {
    const name = normalizeTagName(String(raw))
    if (!name) {
      throw createError({
        statusCode: 400,
        message: `「${String(raw)}」はタグ名として使えません`,
      })
    }
    if (!names.includes(name)) names.push(name)
  }
  return names
}
