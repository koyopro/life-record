import type { ItemDto } from '~~/shared/types/item'

/**
 * 本文から他のタスクを指すリンク（docs/11-scrapbox-notation.md 11.4 / 11.11）。
 *
 * 書き込まれるのは `[/items/<id> 題]` というただの本文で、専用の構造は持たない。
 * ここに集めるのは、その**入れ方**（`[` の候補・貼り付け・ドラッグ＆ドロップ）が
 * 同じ答えを返すようにするため。入れ方ごとに書き分けると、リンクの形や題の
 * 直し方が食い違う。
 */

/** リンクを作るのに要るのはこの2つだけ（一覧の Item からも詳細からも渡せる）。 */
type Linkable = Pick<ItemDto, 'id' | 'title'>

/** 候補を並べるのに、それに加えて見るもの。 */
type Candidate = Linkable & Pick<ItemDto, 'status' | 'updatedAt'>

/** そのタスクのページ（アプリ内のパス）。 */
export function itemPath(id: string): string {
  return `/items/${id}`
}

/**
 * 本文へ差し込むリンクの文字列。
 *
 * 題に角括弧が入っていると**そこでリンクが切れる**（`[/items/x [重要] 出す]` は
 * 途中で閉じてしまう）ので、全角へ寄せる。題が空なら題を付けない
 * （パスだけのリンクとして出る）。
 */
export function itemLinkText(item: Linkable): string {
  const title = item.title.replace(/\[/g, '［').replace(/\]/g, '］').trim()
  return title ? `[${itemPath(item.id)} ${title}]` : `[${itemPath(item.id)}]`
}

/**
 * `[` に続けて打った文字を、タスクの検索語として扱うか
 * （扱うなら `[` の位置とその語を返す）。
 *
 * `[` は他の記法の始まりでもあるので、**その形になったら候補を引っ込める**。
 * 見出し（`[* `）・アプリ内のパス（`[/`）・画像（`[[`）・URL（`[http`）は、
 * リンクしたいタスクを探しているのではない。
 */
export function itemLinkTrigger(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('[')
  if (at === -1) return null

  const query = before.slice(at + 1)
  // `[` を打っただけでは出さない（囲みたいだけのことが多い）
  if (query === '') return null
  // 閉じたあとは、もうこの `[` の中を書いていない
  if (query.includes(']')) return null
  // 記法の始まり（`[* 見出し` `[/diary/…` `[[画像` `[$ 数式` など）
  if (/^[*/[$\-_!#>~%]/.test(query)) return null
  if (/^https?/i.test(query)) return null

  return { start: at, query }
}

/**
 * 候補（`[` で出すタスク）。
 *
 * 手元（IndexedDB）の Item から引くので、オフラインでも待たずに出る。
 * 題の**前方一致 → 部分一致**の順に並べ、その中では**未完了を先**に、
 * 更新の新しい順にする。書きながら指したいのは、たいてい今動いている
 * タスクのため。
 */
export function searchItemsForLink(
  items: Candidate[],
  query: string,
  limit = 8,
): Candidate[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const starts: Candidate[] = []
  const includes: Candidate[] = []
  for (const item of items) {
    const title = item.title.toLowerCase()
    if (title.startsWith(q)) starts.push(item)
    else if (title.includes(q)) includes.push(item)
  }

  return [...starts.sort(byOpenThenRecent), ...includes.sort(byOpenThenRecent)].slice(
    0,
    limit,
  )
}

function byOpenThenRecent(a: Candidate, b: Candidate): number {
  const closed = Number(a.status === 'closed') - Number(b.status === 'closed')
  if (closed !== 0) return closed
  return a.updatedAt < b.updatedAt ? 1 : -1
}

/**
 * タスクのページの URL・パスなら、その id を返す。
 *
 * アドレスバーから写した URL（`https://…/items/<id>`）を本文へ貼ったときに、
 * リンクへ変えるために使う。一覧から開いたときに付く `?…` や `#…` は、
 * どのタスクかには関わらないので落とす。
 */
export function itemIdFromUrl(text: string): string | null {
  const value = text.trim()
  const match =
    /^(?:https?:\/\/[^/]+)?\/items\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#].*)?$/i.exec(
      value,
    )
  return match?.[1] ?? null
}
