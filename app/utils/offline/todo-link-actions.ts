import { linkTodoTitle } from '~~/shared/utils/todo-link'
import { allDiaries, allSections, putDiary, putSection } from './body-repository'
import { allItems, putItem } from './todo-repository'
import { enqueueOperation } from './sync-queue'

/**
 * `[題]` のリンク先が決まったとき、**同じ題の `[題]` をすべて**その TODO へ
 * 向ける（docs/11-scrapbox-notation.md 11.13「同じ題のリンクをまとめて決める」）。
 *
 * とりあえず `[インフルエンザ]` と書いておき、詳しく書きたくなった日に
 * TODO を作ると、それまでの日記や作業記録に書いた `[インフルエンザ]` も
 * まとめて `[/items/<id> インフルエンザ]` に変わる。
 *
 * 手元の写し（開いたことのある日記・作業記録・メモ）はその場で書き換え、
 * サーバーにしか無い分は操作を積んでサーバーで書き換える。
 *
 * 手元の写しは**同期状態を変えずに**書き換える。サーバー側でも同じ書き換えが
 * 起きるので、同期済みのものはそのままサーバーと同じ内容になる。未送信の
 * ものは、そのまま送られる内容が書き換わる（古い `[題]` で上書きしない）。
 * 書き換えた件数を返す。
 */
export async function linkTodoTitleEverywhere(
  itemId: string,
  title: string,
): Promise<number> {
  const text = title.trim()
  if (!text || text.startsWith('/')) return 0

  let changed = 0

  for (const diary of await allDiaries()) {
    const body = linkTodoTitle(diary.body, text, itemId)
    if (body === diary.body) continue
    await putDiary({ ...diary, body })
    changed += 1
  }

  for (const section of await allSections()) {
    const body = linkTodoTitle(section.body, text, itemId)
    if (body === section.body) continue
    await putSection({ ...section, body })
    changed += 1
  }

  /*
   * メモは同期済みのものだけ。未送信の変更があるメモを書き換えると、
   * 送る項目（patch）に入っていない差分が手元だけに残る。サーバー側の
   * 書き換えは届くので、その変更を送り終えて取り直したときに揃う。
   */
  for (const item of await allItems()) {
    if (item.syncState !== 'synced' || !item.note) continue
    const note = linkTodoTitle(item.note, text, itemId)
    if (note === item.note) continue
    await putItem({ ...item, note })
    changed += 1
  }

  await enqueueOperation({
    kind: 'todo_link',
    /*
     * TODO の宛先には並べない。並べると、その TODO の操作として数えられ、
     * 追加を送り終えても「まだ送るものがある」と見なされて同期済みに
     * ならない（sync-engine の hasMoreToSend）。競合の取り下げにも巻き込まれる。
     * 書き換えるのは本文の文字だけなので、TODO が先に届いている必要もない。
     */
    itemIds: [],
    payload: { itemId, title: text },
  })

  return changed
}
