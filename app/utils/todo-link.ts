import type { ItemDto } from '~~/shared/types/item'

/**
 * 本文の `[題]` から TODO を引き当てる（docs/11-scrapbox-notation.md 11.13）。
 *
 * 題は一意ではない（同じ題の TODO は何件でも作れる）ので、**題そのものを
 * リンク先にしない**。押したときに手元の TODO から探し、決まったところで
 * 本文を `[/items/<id> 題]` へ書き換える。以後そのリンクは id で行き先が
 * 決まっているので、題を変えても、同じ題の TODO が増えても動かない。
 *
 * 引くのは**手元（IndexedDB）の一覧**だけ。描くたびに引くのではなく押した
 * ときだけ引くので、本文にリンクがいくつあっても検索は起きない。
 */

/** 引き当てに要るのはこれだけ（一覧の Item からも詳細からも渡せる）。 */
type Candidate = Pick<ItemDto, 'id' | 'title' | 'status' | 'priority' | 'updatedAt'>

export type TodoLinkMatch<T extends Candidate> =
  /** 同じ題が1件だけ。そのままリンク先にしてよい。 */
  | { kind: 'one'; item: T }
  /** 同じ題が複数。**決め打ちにせず**選んでもらう。 */
  | { kind: 'many'; items: T[] }
  /** 同じ題が無い。新しく作るかどうかを尋ねる。 */
  | { kind: 'none' }

/** 題として同じものと見なすか。前後の空白と英字の大小は無視する。 */
function sameTitle(title: string, text: string): boolean {
  return title.trim().toLowerCase() === text.trim().toLowerCase()
}

/**
 * 題の同じ TODO を探す。
 *
 * 消す途中のもの（`pending_delete`）は、押した時点ではもう無いものとして扱う。
 * 並びは `[` の候補と同じ**未完了が先 → 更新の新しい順**。選ぶときに上から
 * 見ていけるようにするためで、選ぶ相手をこちらで決めるわけではない。
 */
export function resolveTodoLink<T extends Candidate & { syncState?: string }>(
  items: T[],
  text: string,
): TodoLinkMatch<T> {
  const found = items
    .filter((item) => item.syncState !== 'pending_delete' && sameTitle(item.title, text))
    .sort(byOpenThenRecent)

  if (found.length === 0) return { kind: 'none' }
  if (found.length === 1) return { kind: 'one', item: found[0]! }
  return { kind: 'many', items: found }
}

function byOpenThenRecent(a: Candidate, b: Candidate): number {
  const closed = Number(a.status === 'closed') - Number(b.status === 'closed')
  if (closed !== 0) return closed
  return a.updatedAt < b.updatedAt ? 1 : -1
}

/**
 * 行の中の n 番目の `needle` を差し替える（リンク先が決まったときの書き換え）。
 *
 * 同じ行に同じ `[題]` が2つあることがあるので、押したものが何番目かを
 * 数えて渡す（数えるのは画面側。描いた順と書かれた順は同じ）。見つからな
 * ければ何も変えない（書き換えている間に本文が変わっていた場合）。
 */
export function replaceNthOccurrence(
  text: string,
  needle: string,
  index: number,
  replacement: string,
): string {
  if (!needle) return text

  let at = -1
  let from = 0
  for (let count = 0; count <= index; count++) {
    at = text.indexOf(needle, from)
    if (at === -1) return text
    from = at + needle.length
  }

  return text.slice(0, at) + replacement + text.slice(at + needle.length)
}
