import { SEARCH_EXCERPT_LENGTH, SEARCH_TOTAL_LIMIT, type SearchHit } from '~~/shared/types/search'

/**
 * 検索結果の組み立てのうち、サーバーと手元で**同じでなければならない**もの
 * （docs/03-functional-spec.md 3.6）。
 *
 * 検索はまず手元（IndexedDB）の分を出し、サーバーの応答が届いたら重ねる。
 * 抜粋の切り出し方や並べ方がずれていると、応答が届いた瞬間に同じ行の
 * 見た目や位置が変わる。
 */

/**
 * 一致した箇所の前後を切り出す。
 *
 * 本文の先頭から出すと、長い文章では一致箇所が見えない。
 * 見つかった位置を中心に置く。
 */
export function excerptAround(body: string, query: string): string {
  const text = body.replace(/\s+/g, ' ').trim()
  if (text.length <= SEARCH_EXCERPT_LENGTH) return text

  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return `${text.slice(0, SEARCH_EXCERPT_LENGTH)}…`

  // 一致箇所の少し前から始める
  const margin = Math.floor((SEARCH_EXCERPT_LENGTH - query.length) / 3)
  const start = Math.max(0, at - margin)
  const end = Math.min(text.length, start + SEARCH_EXCERPT_LENGTH)

  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/**
 * 同じタスクの行を1つにまとめる（docs/03-functional-spec.md 3.6）。
 *
 * タイトル・メモ・作業記録は**どれも同じタスクの中身**なので、当たった
 * 場所の数だけ行が増えると、同じタスクが何度も並ぶ。探しているのは
 * タスクであって、当たった場所ではない。
 *
 * 残すのは**いちばん新しい当たり**。日付の新しい順に並べる中で、その
 * タスクがいちばん上に出るはずだった位置に置く。作業記録で当たったので
 * あれば、その日付と抜粋がそのまま行に添う（どこに書いてあって当たったかは
 * カードだけでは分からない）。
 *
 * 日記はタスクに紐づかないので、まとめる相手がいない。そのまま残す。
 */
function collapseByItem(hits: SearchHit[]): SearchHit[] {
  /** すでに置いたタスクが、下の配列のどこにいるか。 */
  const at = new Map<string, number>()
  const kept: SearchHit[] = []

  for (const hit of hits) {
    const itemId = hit.item?.id
    if (itemId === undefined) {
      kept.push(hit)
      continue
    }

    const index = at.get(itemId)
    if (index === undefined) {
      at.set(itemId, kept.length)
      kept.push(hit)
      continue
    }

    /*
     * 同じタスクの2つ目以降。新しいほうだけを残す。
     *
     * 同着なら先に来たものを残す。渡される順（タスク → 作業記録）も
     * 重ねる順（サーバー → 手元）も両側で同じなので、どちらで組み立てても
     * 同じ行が残る。ずれていると、応答が届いた瞬間に行が入れ替わる。
     */
    if (hit.date > kept[index]!.date) kept[index] = hit
  }

  return kept
}

/**
 * 結果を出す形に整える。同じタスクの行をまとめ、日付の新しい順に並べ、
 * 返す件数で切る。
 *
 * **サーバーと手元で必ず同じものを通す**。3つを別々の関数にすると、
 * 片方でだけ掛け忘れたときに、応答が届いた瞬間に行が増えたり入れ替わったり
 * する。1つにまとめて、半分だけ適用できないようにしておく。
 *
 * 同じ日付の中は**渡された順のまま**にする（並べ替えは安定）。種別ごとに
 * 並べてから渡す決まりで、ここで別の鍵を持ち出すと、サーバーの応答が
 * 届いたときに同じ日付の行が入れ替わって見える。
 *
 * まとめるのは件数で切る**前**。同じタスクの重複で枠を使ってしまうと、
 * 出せるはずのタスクが上限からこぼれる。
 */
export function finalizeSearchHits(hits: SearchHit[]): SearchHit[] {
  return collapseByItem(hits)
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
    .slice(0, SEARCH_TOTAL_LIMIT)
}

/**
 * 手元の結果へ、サーバーの結果を重ねる。
 *
 * 同じ行（id が同じ）はサーバーのものを採る。抜粋やタグはサーバーのほうが
 * 揃っているため。**手元にしか無い行は残す**。
 *
 * - まだ送れていないタスク（オフラインで追加したもの）
 * - サーバーが返しきれなかった分（件数の上限）
 *
 * 逆に、手元がまだ持っていない作業記録・日記（開いたことのないもの）は
 * サーバー側にしかない。どちらか一方では欠けるので、重ねて出す。
 *
 * 重ねたあとにもう一度まとめ直す（`finalizeSearchHits`）。同じタスクでも、
 * サーバーはまだ手元に無い作業記録で当て、手元はタイトルで当てる、という
 * ように**別の行が残ることがある**ため。
 */
export function mergeSearchHits(server: SearchHit[], local: SearchHit[]): SearchHit[] {
  const known = new Set(server.map((hit) => hit.id))
  return finalizeSearchHits([...server, ...local.filter((hit) => !known.has(hit.id))])
}
