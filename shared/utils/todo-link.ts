import type { Inline, Line } from './scrapbox/types'
import { parseScrapbox } from './scrapbox/parse'

/**
 * `[題]`（リンク先の決まっていない TODO リンク）を、決まった形
 * `[/items/<id> 題]` へ書き換える（docs/11-scrapbox-notation.md 11.13）。
 *
 * クライアント（手元の写し）とサーバー（`POST /api/todo-links`）の両方で
 * 使う。書き換え方が食い違うと、手元とサーバーで本文が分かれてしまうため、
 * ここだけで決める。
 */

/** 題として同じものと見なすか。前後の空白と英字の大小は無視する。 */
export function sameTodoTitle(title: string, text: string): boolean {
  return title.trim().toLowerCase() === text.trim().toLowerCase()
}

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
export function itemLinkText(item: { id: string; title: string }): string {
  const title = item.title.replace(/\[/g, '［').replace(/\]/g, '］').trim()
  return title ? `[${itemPath(item.id)} ${title}]` : `[${itemPath(item.id)}]`
}

/**
 * 本文の中の `[題]` を、すべて `[/items/<id> 題]` に書き換える。
 * 何も当たらなければ、渡された本文をそのまま返す。
 *
 * 文字列の置換ではなく、**記法として `[題]` になっている所だけ**を書き換える。
 * コード（`` `[題]` `` やコードブロック）・強調（`[[題]]`）の中に同じ文字が
 * あっても、それはリンクではないので触らない。
 *
 * 見出しは書かれたままを残す（`[インフルエンザ]` と `[インフルエンザ ]` は
 * 同じ TODO を指すが、それぞれの書き方を保つ）。
 */
export function linkTodoTitle(body: string, title: string, itemId: string): string {
  if (!title.trim() || !body.includes('[')) return body

  const lines = body.split('\n')
  let parsed = parseScrapbox(body)
  let changed = false

  for (let index = 0; index < lines.length; index++) {
    let remaining = matchingLinks(parsed[index], title)
    if (remaining.length === 0) continue

    let line = lines[index]!
    let from = 0

    while (remaining.length > 0) {
      const found = nextRaw(line, remaining, from)
      if (!found) break

      const replacement = itemLinkText({ id: itemId, title: found.title })
      const candidate =
        line.slice(0, found.at) + replacement + line.slice(found.at + found.raw.length)

      /*
       * 書き換えて、その行のリンクが1つ減ったときだけ採る。同じ文字がコードの
       * 中にもあると、文字の位置だけではどちらがリンクか分からないため、
       * 記法として読み直して確かめる（行の読み方は前の行に左右される
       * ——コードブロック・表——ので、本文ごと読み直す）。
       */
      const next = [...lines.slice(0, index), candidate, ...lines.slice(index + 1)]
      const reparsed = parseScrapbox(next.join('\n'))
      const left = matchingLinks(reparsed[index], title)

      if (left.length === remaining.length - 1) {
        line = candidate
        lines[index] = candidate
        parsed = reparsed
        remaining = left
        changed = true
        from = found.at + replacement.length
      } else {
        from = found.at + 1
      }
    }
  }

  return changed ? lines.join('\n') : body
}

interface MatchingLink {
  raw: string
  title: string
}

/** その行にある、題の当たる `[題]`（書かれた順）。 */
function matchingLinks(line: Line | undefined, title: string): MatchingLink[] {
  if (!line) return []

  const found: MatchingLink[] = []
  const visit = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === 'pageLink') {
        // `[/…]` はアプリ内パスの書き損じで、TODO の題ではない
        if (!node.title.startsWith('/') && sameTodoTitle(node.title, title)) {
          found.push({ raw: node.raw, title: node.title })
        }
      } else if (node.type === 'decoration' || node.type === 'link') {
        visit(node.nodes)
      }
    }
  }

  if (line.type === 'text' || line.type === 'quote') visit(line.nodes)
  if (line.type === 'tableRow') for (const cell of line.cells) visit(cell)
  return found
}

/** `from` 以降で最初に出てくる `[題]`。 */
function nextRaw(
  line: string,
  links: MatchingLink[],
  from: number,
): (MatchingLink & { at: number }) | null {
  let best: (MatchingLink & { at: number }) | null = null
  for (const link of links) {
    const at = line.indexOf(link.raw, from)
    if (at !== -1 && (!best || at < best.at)) best = { ...link, at }
  }
  return best
}
