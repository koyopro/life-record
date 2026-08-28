import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { itemTags, items, sections } from '~~/server/db/schema'
import { assertUuid, toItemDto, toItemDtos } from '~~/server/utils/items'
import { ensureTags } from '~~/server/utils/tags'
import { isItemStatus, isPriority, type ItemDetailDto } from '~~/shared/types/item'

/**
 * 削除した Item を、DELETE が返したスナップショットから復元する。
 * Undo（`u`）専用（docs/08-todo-management.md 8.4）。
 *
 * 元と同じ id で作り直すため、他の画面が保持している参照がそのまま生きる。
 */
export default defineEventHandler(async (event) => {
  const snapshot = await readBody<ItemDetailDto>(event)

  if (typeof snapshot?.title !== 'string' || !snapshot.title.trim()) {
    throw createError({ statusCode: 400, message: '不正な内容です' })
  }
  const id = assertUuid(snapshot.id)
  if (!isItemStatus(snapshot.status)) {
    throw createError({ statusCode: 400, message: '不正な status です' })
  }
  if (snapshot.priority !== null && !isPriority(snapshot.priority)) {
    throw createError({ statusCode: 400, message: '不正な重要度です' })
  }

  const db = useDb()

  return await db.transaction(async (tx) => {
    /*
     * すでに戻っているなら、そのまま返す（冪等）。
     * オフライン同期では同じ復元が二度届くことがある（docs/12-offline.md 12.6）。
     */
    const [existing] = await tx.select().from(items).where(eq(items.id, id))
    if (existing) {
      const [dto] = await toItemDtos(tx, [existing])
      return dto!
    }

    const [restored] = await tx
      .insert(items)
      .values({
        id,
        title: snapshot.title,
        status: snapshot.status,
        priority: snapshot.priority,
        url: snapshot.url ?? null,
        note: snapshot.note ?? null,
        dueAt: snapshot.dueAt ? new Date(snapshot.dueAt) : null,
        dueHasTime: Boolean(snapshot.dueHasTime),
        // 繰り返しは rule と basis が揃っていなければ CHECK 制約に掛かる
        recurrenceRule: snapshot.recurrenceBasis ? snapshot.recurrenceRule : null,
        recurrenceBasis: snapshot.recurrenceRule ? snapshot.recurrenceBasis : null,
        seriesId: snapshot.seriesId ?? null,
        completedAt: snapshot.completedAt ? new Date(snapshot.completedAt) : null,
        createdAt: new Date(snapshot.createdAt),
        updatedAt: new Date(snapshot.updatedAt),
      })
      .returning()

    if (!restored) {
      throw createError({ statusCode: 500, message: '復元に失敗しました' })
    }

    const restoredSections = snapshot.sections ?? []
    if (restoredSections.length > 0) {
      await tx.insert(sections).values(
        restoredSections.map((section) => ({
          id: assertUuid(section.id, 'Section ID'),
          itemId: id,
          date: section.date,
          body: section.body,
          position: section.position,
          createdAt: new Date(section.createdAt),
          updatedAt: new Date(section.updatedAt),
        })),
      )
    }

    // 本文は最初に作られた Section。スナップショットは表示順（日付昇順）で
    // 並んでいるので、先頭をそのまま使うと別の日の記録を拾ってしまう。
    const primaryBody =
      [...restoredSections].sort((a, b) =>
        a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? -1 : 1,
      )[0]?.body ?? null

    const restoredTags = Array.isArray(snapshot.tags) ? snapshot.tags : []
    if (restoredTags.length > 0) {
      const tagIds = await ensureTags(tx, restoredTags)
      await tx
        .insert(itemTags)
        .values([...tagIds.values()].map((tagId) => ({ itemId: id, tagId })))
        .onConflictDoNothing()
    }

    return toItemDto(restored, primaryBody, restoredTags)
  })
})
