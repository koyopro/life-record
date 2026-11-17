import { inArray, sql } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { tags } from '~~/server/db/schema'
import { assertUuid } from '~~/server/utils/items'
import { listTagsWithCount } from '~~/server/utils/tags'
import type { TagDto } from '~~/shared/types/tag'

/**
 * タグの並び順を変える（docs/09-tags.md 9.3「並べ替え」）。
 *
 * 並びは常にまとめて受け取り、渡された順に 0 から振り直す。1件ずつ
 * position を送る形にすると、途中で失敗したときに番号が重なって残る。
 *
 * 渡されなかったタグは触らない（並べ替えている間に作られたタグなど）。
 * 渡された id がすでに無い（参照が0になって消えた）ものは黙って飛ばす。
 * 並べ替えの途中でタグが1つ消えただけで全体を失敗させる理由はないため。
 *
 * 返すのは並べ替えた後の一覧（GET /api/tags と同じもの）。
 */
export default defineEventHandler(async (event): Promise<TagDto[]> => {
  const payload = await readBody<{ ids?: unknown }>(event)

  if (!Array.isArray(payload?.ids) || payload.ids.length === 0) {
    throw createError({ statusCode: 400, message: '並び順が空です' })
  }

  const ids = payload.ids.map((id) => assertUuid(id, 'タグID'))
  if (new Set(ids).size !== ids.length) {
    throw createError({ statusCode: 400, message: '同じタグが重複しています' })
  }

  const db = useDb()
  const list = sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`

  // 1文で振り直す。array_position は 1 始まり
  await db
    .update(tags)
    .set({ position: sql`array_position(${list}, ${tags.id}) - 1` })
    .where(inArray(tags.id, ids))

  return await listTagsWithCount(db)
})
