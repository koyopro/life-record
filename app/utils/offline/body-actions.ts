import { nextPositionIn } from '~/utils/section-order'
import type { LocalSection } from './local-database'
import {
  deleteSection,
  getDiary,
  getSection,
  pendingDiaries,
  pendingSections,
  putDiary,
  putSection,
  sectionsOfItem,
} from './body-repository'
import {
  cancelOperations,
  enqueueOnce,
  listOperations,
  type DiarySavePayload,
  type SectionDeletePayload,
  type SectionSavePayload,
} from './sync-queue'

/**
 * 本文（作業記録＝Section と日記）への操作。
 *
 * TODO の todo-actions と同じく、「ローカルへ書く」と「送る操作を列へ積む」を
 * 1組にしたもの。画面からは `useItemDetailStore` / `useDiaryStore` を通す。
 *
 * 打鍵のたびにローカルへ書くが、**列に積むのは対象ごとに1つだけ**。
 * 送る内容は送信の直前に手元から取り直すため、それで最新が届く
 * （docs/12-offline.md 12.7）。
 */

/** その作業記録の保存が、まだ列に残っているか。 */
function matchesSectionSave(id: string) {
  return (operation: { kind: string; payload: unknown }) =>
    operation.kind === 'section_save' &&
    (operation.payload as SectionSavePayload).id === id
}

function matchesDiarySave(date: string) {
  return (operation: { kind: string; payload: unknown }) =>
    operation.kind === 'diary_save' &&
    (operation.payload as DiarySavePayload).date === date
}

/**
 * 作業記録を書く（無ければ作る）。
 *
 * id は呼び出し側（ストア）が決める。オフラインで書いた記録にもその場で
 * id が要るためで、同じ id を送ってもサーバーは同じ1件を上書きする。
 */
export async function saveSectionBody(
  params: {
    id: string
    itemId: string
    date: string
    body: string
    /** 新しく作るときの並び順。省略すれば同じ日付の末尾に置く。 */
    position?: number
  },
  now: Date = new Date(),
): Promise<void> {
  const local = await getSection(params.id)
  const stamp = now.toISOString()

  const next: LocalSection = local
    ? { ...local, date: params.date, body: params.body, updatedAt: stamp, syncState: 'pending_save' }
    : {
        id: params.id,
        itemId: params.itemId,
        date: params.date,
        body: params.body,
        // 同じ日付の末尾に置く（サーバーと同じ規則。docs/02-data-model.md 2.4）
        position:
          params.position ??
          nextPositionIn(await sectionsOfItem(params.itemId), params.date),
        createdAt: stamp,
        updatedAt: stamp,
        syncState: 'pending_save',
      }

  await putSection(next)
  await enqueueOnce(
    {
      kind: 'section_save',
      itemIds: [params.itemId],
      payload: { id: params.id, itemId: params.itemId, date: params.date, body: params.body },
    },
    matchesSectionSave(params.id),
    now,
  )
}

/**
 * 作業記録を消す。
 *
 * まだ送っていない保存は取り下げる（送ってから消すと往復が無駄になる）。
 * サーバーに無い記録を消しても 404 は成功と同じに扱うので、一度も届いて
 * いない記録でもそのまま送ってよい（docs/12-offline.md 12.6）。
 */
export async function removeSectionLocally(
  id: string,
  itemId: string,
  now: Date = new Date(),
): Promise<void> {
  await cancelOperations(matchesSectionSave(id))

  const local = await getSection(id)
  if (!local) return

  await putSection({ ...local, syncState: 'pending_delete' })
  await enqueueOnce(
    { kind: 'section_delete', itemIds: [itemId], payload: { id, itemId } },
    (operation) =>
      operation.kind === 'section_delete' &&
      (operation.payload as SectionDeletePayload).id === id,
    now,
  )
}

/** 同じ日付の記録を並べ替える。並びはまとめて送る。 */
export async function reorderSectionsLocally(
  itemId: string,
  ids: string[],
  now: Date = new Date(),
): Promise<void> {
  for (const [index, id] of ids.entries()) {
    const local = await getSection(id)
    if (!local) continue
    // 送るまでの間にサーバーの内容で戻されないよう、未送信の印を付ける
    await putSection({ ...local, position: index, syncState: 'pending_save' })
  }

  await enqueueOnce(
    { kind: 'section_reorder', itemIds: [itemId], payload: { itemId, ids } },
    (operation) =>
      operation.kind === 'section_reorder' &&
      (operation.payload as { itemId: string }).itemId === itemId,
    now,
  )
}

/** 日記の本文を書く。空にすればサーバー側では消える。 */
export async function saveDiaryBody(
  date: string,
  body: string,
  now: Date = new Date(),
): Promise<void> {
  const local = await getDiary(date)

  await putDiary({
    date,
    body,
    // 更新日時はサーバーが決める。届くまでは手元で見た最後の値のまま
    updatedAt: local?.updatedAt ?? null,
    syncState: 'pending_save',
  })

  await enqueueOnce(
    { kind: 'diary_save', itemIds: [], payload: { date, body } },
    matchesDiarySave(date),
    now,
  )
}

/**
 * まだ送れていない本文のうち、列に操作が残っていないものを積み直す。
 *
 * 起動時に1度呼ぶ。積んだ操作は IndexedDB にあるので普通は残っているが、
 * 競合の後始末などで取り下げられることがある。書いたものが手元に残った
 * まま送られない状態を作らない。
 */
export async function resumePendingBodies(now: Date = new Date()): Promise<void> {
  const operations = await listOperations()

  for (const section of await pendingSections()) {
    if (section.syncState === 'pending_delete') {
      if (operations.some((operation) =>
        operation.kind === 'section_delete' &&
        (operation.payload as SectionDeletePayload).id === section.id,
      )) continue

      await enqueueOnce(
        {
          kind: 'section_delete',
          itemIds: [section.itemId],
          payload: { id: section.id, itemId: section.itemId },
        },
        (operation) =>
          operation.kind === 'section_delete' &&
          (operation.payload as SectionDeletePayload).id === section.id,
        now,
      )
      continue
    }

    if (operations.some(matchesSectionSave(section.id))) continue
    await enqueueOnce(
      {
        kind: 'section_save',
        itemIds: [section.itemId],
        payload: {
          id: section.id,
          itemId: section.itemId,
          date: section.date,
          body: section.body,
        },
      },
      matchesSectionSave(section.id),
      now,
    )
  }

  for (const diary of await pendingDiaries()) {
    if (operations.some(matchesDiarySave(diary.date))) continue
    await enqueueOnce(
      { kind: 'diary_save', itemIds: [], payload: { date: diary.date, body: diary.body } },
      matchesDiarySave(diary.date),
      now,
    )
  }
}

/** Item を消したら、その作業記録も手元から消す（宛先の無い写しを残さない）。 */
export async function dropSectionsOfItem(itemId: string): Promise<void> {
  for (const section of await sectionsOfItem(itemId)) await deleteSection(section.id)
}
