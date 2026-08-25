import { eq } from 'drizzle-orm'
import type { Db } from '~~/server/db'
import { itemTags, items, type Item } from '~~/server/db/schema'
import { tagsByItemId } from '~~/server/utils/tags'
import { nextDueAt } from '~~/shared/utils/recurrence'
import type { Recurrence } from '~~/shared/types/recurrence'

type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * 繰り返し中の Item を完了したとき、次回分を新しい Item として作る
 * （docs/10-recurrence.md 10.2）。
 *
 * 1つの Item を使い回して due_at だけ進める方式は採らない。
 * 回ごとに Section（作業記録）を独立させたいため。
 *
 * @returns 作成した次回オカレンス。終了条件に達していれば null
 */
export async function createNextOccurrence(
  tx: Executor,
  completed: Item,
  completedAt: Date,
): Promise<Item | null> {
  if (!completed.recurrenceRule || !completed.recurrenceBasis) return null

  const recurrence: Recurrence = {
    rule: completed.recurrenceRule,
    basis: completed.recurrenceBasis,
  }

  const seriesId = completed.seriesId ?? completed.id

  // COUNT の判定には、系列にこれまで何件あるかが要る
  const occurrences = await tx
    .select({ id: items.id })
    .from(items)
    .where(eq(items.seriesId, seriesId))

  // 起点 Item にまだ series_id が入っていない場合、自分自身が1件目
  const occurrencesSoFar = Math.max(occurrences.length, 1)

  // basis=due は元の期限が起点。期限が未設定なら完了日時を起点にする
  // （他に起点がないため。UI 側では繰り返し設定時に期限入力を促す）
  const from =
    recurrence.basis === 'completion'
      ? completedAt
      : (completed.dueAt ?? completedAt)

  const due = nextDueAt(recurrence, from, completedAt, occurrencesSoFar)
  if (!due) return null

  const [created] = await tx
    .insert(items)
    .values({
      title: completed.title,
      // 未着手として出す（docs/10-recurrence.md 10.5）
      status: 'backlog',
      priority: completed.priority,
      /*
       * URL も引き継ぐ（10.5）。毎週見に行くページ・毎月開く申請フォームの
       * ように、回が変わっても行き先は同じものが多い。要らなければ外せるが、
       * 毎回貼り直すのは手間が大きい。
       */
      url: completed.url,
      dueAt: due,
      dueHasTime: completed.dueHasTime,
      recurrenceRule: completed.recurrenceRule,
      recurrenceBasis: completed.recurrenceBasis,
      seriesId,
    })
    .returning()

  if (!created) return null

  // タグは引き継ぐ。Section（作業記録）は引き継がない。
  const tagNames = await tagsByItemId(tx, [completed.id])
  const names = tagNames.get(completed.id) ?? []
  if (names.length > 0) {
    const rows = await tx
      .select({ tagId: itemTags.tagId })
      .from(itemTags)
      .where(eq(itemTags.itemId, completed.id))

    await tx
      .insert(itemTags)
      .values(rows.map((row) => ({ itemId: created.id, tagId: row.tagId })))
      .onConflictDoNothing()
  }

  // 起点 Item にも series_id を入れ、系列を辿れるようにする
  if (!completed.seriesId) {
    await tx
      .update(items)
      .set({ seriesId })
      .where(eq(items.id, completed.id))
  }

  return created
}
