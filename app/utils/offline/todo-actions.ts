import type { ItemDetailDto, ItemDto, ItemPatch } from '~~/shared/types/item'
import type { LocalItem } from './local-database'
import { getItem, putItem, toLocalItem } from './todo-repository'
import { cancelOperations, enqueueOperation } from './sync-queue'
import { takeDeletedSnapshot } from './deleted-snapshots'

/**
 * TODO への操作。
 *
 * 「ローカルへ書く」と「送る操作を列へ積む」を1組にしたもの。画面から
 * 直接呼ぶことはせず、useItemStore が呼んだあとに読み直す。
 * 送信はここではしない（useSync が後から行う）。
 */

/** 追加する。id と内容はクライアントで決める。 */
export async function createTodo(draft: ItemDto, text: string): Promise<void> {
  await putItem(toLocalItem(draft, 'pending_create'))
  await enqueueOperation({
    kind: 'create',
    itemIds: [draft.id],
    payload: { id: draft.id, text },
  })
}

/** 指定した Item をまとめて変更する。 */
export async function patchTodos(
  ids: string[],
  values: ItemPatch,
  now: Date = new Date(),
): Promise<void> {
  for (const id of ids) {
    const local = await getItem(id)
    if (!local) continue

    await putItem(withPatch(local, values, now.toISOString()))
    await enqueueOperation(
      {
        kind: 'patch',
        itemIds: [id],
        // 競合の基準は送る直前に入れ直す（sync-engine の withCurrentBase）。
        // 前の操作が通れば基準は進むため、ここでの値は控えにすぎない
        payload: { id, patch: values, baseUpdatedAt: local.baseUpdatedAt },
      },
      now,
    )
  }
}

/** タグを付け外しする。付ける・外すは集合の操作なので、何度送っても同じ。 */
export async function applyTodoTags(
  ids: string[],
  add: string[],
  remove: string[],
  now: Date = new Date(),
): Promise<void> {
  if (add.length === 0 && remove.length === 0) return

  for (const id of ids) {
    const local = await getItem(id)
    if (!local) continue

    const tags = new Set(local.tags.filter((name) => !remove.includes(name)))
    for (const name of add) tags.add(name)

    await putItem({
      ...local,
      tags: [...tags].sort(),
      updatedAt: now.toISOString(),
      syncState:
        local.syncState === 'pending_create' ? 'pending_create' : 'pending_update',
    })
    await enqueueOperation(
      { kind: 'tags', itemIds: [id], payload: { ids: [id], add, remove } },
      now,
    )
  }
}

/**
 * 削除する。
 *
 * 記録はすぐには消さず、`pending_delete` の印を付けて残す。送信が通るまでは
 * 取り消せるようにしておきたいため。一覧は印を見て隠す。
 */
export async function removeTodos(
  ids: string[],
  now: Date = new Date(),
): Promise<void> {
  for (const id of ids) {
    const local = await getItem(id)
    if (!local) continue
    await putItem({ ...local, syncState: 'pending_delete' })
    await enqueueOperation({ kind: 'delete', itemIds: [id], payload: { id } }, now)
  }
}

/**
 * 削除を取り消す。
 *
 * まだ送っていなければ、送らずに取り消す（一番安全）。すでに送ってしまって
 * いたら、削除の応答として受け取った控えをサーバーへ戻す。
 */
export async function restoreTodos(
  ids: string[],
  now: Date = new Date(),
): Promise<void> {
  for (const id of ids) {
    const cancelled = await cancelOperations(
      (operation) => operation.kind === 'delete' && operation.itemIds.includes(id),
    )
    const local = await getItem(id)

    if (local && cancelled > 0) {
      await putItem({
        ...local,
        syncState: local.baseUpdatedAt ? 'synced' : 'pending_create',
      })
      continue
    }

    const snapshot = takeDeletedSnapshot(id) ?? (local ? toSnapshot(local) : null)
    if (!snapshot) continue

    await putItem(toLocalItem(pickItemFields(snapshot), 'pending_create'))
    await enqueueOperation(
      { kind: 'restore', itemIds: [id], payload: { snapshot } },
      now,
    )
  }
}

/**
 * ローカルの Item へ変更を当てる。
 *
 * サーバー（server/utils/item-patch.ts）と同じ結果になるようにする。
 * ずれていると、送信が通って取り直した瞬間に表示が変わってしまう。
 */
export function withPatch(
  local: LocalItem,
  values: ItemPatch,
  now: string,
): LocalItem {
  const defined = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as ItemPatch

  const next: LocalItem = {
    ...local,
    ...defined,
    updatedAt: now,
    syncState:
      local.syncState === 'pending_create' ? 'pending_create' : 'pending_update',
  }

  // 期限を消したら、時刻指定の有無も意味を失う
  if (defined.dueAt === null) next.dueHasTime = false

  return next
}

/** ローカルの記録から、復元に渡せる形を作る。Section は持っていない。 */
function toSnapshot(local: LocalItem): ItemDetailDto {
  return { ...pickItemFields(local), sections: [], primarySectionId: null }
}

/** ItemDto の項目だけを取り出す。同期の印や Section を混ぜて保存しないため。 */
function pickItemFields(source: ItemDto): ItemDto {
  return {
    id: source.id,
    title: source.title,
    status: source.status,
    priority: source.priority,
    url: source.url,
    dueAt: source.dueAt,
    dueHasTime: source.dueHasTime,
    body: source.body,
    tags: source.tags,
    recurrenceRule: source.recurrenceRule,
    recurrenceBasis: source.recurrenceBasis,
    seriesId: source.seriesId,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}
