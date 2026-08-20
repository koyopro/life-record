import type { ItemDto } from '~~/shared/types/item'

/** コピーに要るのはこの2つだけ。ローカルの Item からも詳細からも渡せる。 */
type Copyable = Pick<ItemDto, 'title' | 'body'>

/**
 * クリップボードへ書く文字列を作る（`Shift` + `C`）。
 *
 * 1件なら「1行目タイトル、2行目以降が本文」。追加の入力と同じ形なので
 * （docs/08-todo-management.md 8.5、buildItemDraft）、貼り直せば同じ内容の
 * タスクを作れる。
 *
 * 複数件はタイトルだけを並べる。本文まで混ぜるとどこまでが1件なのか
 * 読めなくなるため。
 */
export function composeItemCopyText(items: Copyable[]): string {
  if (items.length !== 1) return items.map((item) => item.title).join('\n')

  const [item] = items as [Copyable]
  // 行末の空白は貼り先で邪魔になるだけ。行頭は字下げとして意味を持つので残す
  const body = (item.body ?? '').replace(/\s+$/, '')
  return body ? `${item.title}\n${body}` : item.title
}
