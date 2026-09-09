import { eq } from 'drizzle-orm'
import type { Db } from '~~/server/db'
import { itemTags, items, type Item } from '~~/server/db/schema'
import { tagsByItemId } from '~~/server/utils/tags'
import { nextDueAt } from '~~/shared/utils/recurrence'
import type { ItemStatus } from '~~/shared/types/item'
import type { Recurrence } from '~~/shared/types/recurrence'

type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

/** 重複の判定に使う、系列にすでにある回。 */
export interface SeriesOccurrence {
  id: string
  status: ItemStatus
  dueAt: Date | null
  generatedFrom: string | null
}

/** 次回分を作らない理由（docs/10-recurrence.md 10.9）。 */
export type SkipReason =
  /** この完了から生まれた回が、すでにある（同じ完了が二度届いた） */
  | 'already_generated'
  /** 未完了の回がすでにある。未完了は常に1つ（10.2） */
  | 'open_occurrence'
  /** 同じ期限の回がすでにある */
  | 'same_due'

/**
 * 次回分を作らない理由。作ってよければ null。
 *
 * 同じ完了が二度届くことは避けられない。応答が返らなかった送信は送り直され
 * （docs/12-offline.md 12.6）、その送り直しが1回目の処理と**重なる**ことが
 * ある（打ち切りはクライアント側の待ちを止めるだけで、サーバーの処理は
 * 走り続ける）。「完了への遷移」だけを見ていると、どちらの取引からも
 * 「まだ open」に見えて、次回分が2件できる。
 *
 * そこで、完了の遷移とは別に**系列の側から**重複を見る。
 */
export function skipReasonOf(
  series: SeriesOccurrence[],
  completedId: string,
  due: Date,
): SkipReason | null {
  // この完了から生まれた回がすでにある。送り直し・二重送信はここで止まる
  if (series.some((row) => row.generatedFrom === completedId)) {
    return 'already_generated'
  }

  /*
   * 未完了の回がすでにある（10.2「未完了オカレンスは常に1つ」）。
   *
   * 完了を取り消して（`u`）もう一度完了したときに、1回目で生まれた回が
   * 残ったまま2件目ができるのを防ぐ。`generated_from` を持たない古い
   * Item（この仕組みより前に生まれた回）にも効く。
   */
  if (series.some((row) => row.id !== completedId && row.status !== 'closed')) {
    return 'open_occurrence'
  }

  // 同じ期限の回がすでにある。次回期限は前の回より必ず後になるので
  // （10.4）、一致するなら同じ回を作り直そうとしている
  if (series.some((row) => row.dueAt?.getTime() === due.getTime())) {
    return 'same_due'
  }

  return null
}

/**
 * 繰り返し中の Item を完了したとき、次回分を新しい Item として作る
 * （docs/10-recurrence.md 10.2）。
 *
 * 1つの Item を使い回して due_at だけ進める方式は採らない。
 * 回ごとに Section（作業記録）を独立させたいため。
 *
 * **同じ完了について二度呼ばれても、作るのは1つだけ**（10.9）。
 *
 * @returns 作成した次回オカレンス。終了条件に達していれば null。
 *          すでに作られていた場合も null（作り直さない）
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

  // COUNT の判定には、系列にこれまで何件あるかが要る。
  // 同じ回を作り直そうとしていないかも、この一覧で確かめる
  const occurrences = await tx
    .select({
      id: items.id,
      status: items.status,
      dueAt: items.dueAt,
      generatedFrom: items.generatedFrom,
    })
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

  if (skipReasonOf(occurrences, completed.id, due)) return null

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
      /*
       * メモも引き継ぐ（10.5）。回をまたいで残したい手順・前提の置き場
       * として持たせているもので、これが引き継がれないと置く意味がない。
       * 引き継ぐのは**写し**で、共有ではない。次の回で書き換えても、
       * 済んだ回に書いてあったことは当時のまま残る。
       */
      note: completed.note,
      dueAt: due,
      dueHasTime: completed.dueHasTime,
      recurrenceRule: completed.recurrenceRule,
      recurrenceBasis: completed.recurrenceBasis,
      seriesId,
      // どの完了から生まれた回か。二度作らないための鍵（10.9）
      generatedFrom: completed.id,
    })
    /*
     * 上の `skipReasonOf` をすり抜けた同時実行への最後の砦。
     *
     * 確かめてから入れるまでの間に同じ完了がもう一度届くと、どちらの取引
     * からも「まだ無い」と見える（互いの未コミットの行は見えない）。
     * ここで一意制約に当たった側は何も入れずに終わる。
     */
    .onConflictDoNothing({ target: items.generatedFrom })
    .returning()

  // 競り負けた（同じ完了の処理が先に入っていた）。作り直さない
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
