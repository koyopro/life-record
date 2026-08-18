/**
 * Item を本文へドラッグ＆ドロップして、そのタスクへのリンクを挿入するための
 * データの受け渡し（ドラッグ元と ScrapboxEditor で共有する）。
 *
 * 日記の「この日にやったこと」からタスクを開かずに、本文へ
 * `[/items/<id> タイトル]`（docs/11-scrapbox-notation.md
 * 「アプリ内のページへのリンク」）を差し込めるようにする。
 */

const ITEM_LINK_DATA_TYPE = 'application/x-datalake-item-link'

export interface ItemDragPayload {
  id: string
  title: string
}

/** ドラッグ元で呼ぶ。`dragstart` にそのまま渡す。 */
export function startItemLinkDrag(event: DragEvent, payload: ItemDragPayload): void {
  event.dataTransfer?.setData(ITEM_LINK_DATA_TYPE, JSON.stringify(payload))
}

/** `dragover` で使う。実際のデータは `drop` まで読めないため、型の有無だけ見る。 */
export function isItemLinkDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer?.types.includes(ITEM_LINK_DATA_TYPE))
}

/** `drop` で使う。壊れたデータや別由来のドラッグは null を返す。 */
export function readItemLinkDrag(dataTransfer: DataTransfer | null): ItemDragPayload | null {
  const raw = dataTransfer?.getData(ITEM_LINK_DATA_TYPE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ItemDragPayload>
    if (typeof parsed.id !== 'string' || typeof parsed.title !== 'string') return null
    return { id: parsed.id, title: parsed.title }
  } catch {
    return null
  }
}
