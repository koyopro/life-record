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
 * 日付の新しい順に並べ、返す件数で切る。
 *
 * 同じ日付の中は**渡された順のまま**にする（並べ替えは安定）。種別ごとに
 * 並べてから渡す決まりで、ここで別の鍵を持ち出すと、サーバーの応答が
 * 届いたときに同じ日付の行が入れ替わって見える。
 */
export function sortSearchHits(hits: SearchHit[]): SearchHit[] {
  return [...hits]
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
 */
export function mergeSearchHits(server: SearchHit[], local: SearchHit[]): SearchHit[] {
  const known = new Set(server.map((hit) => hit.id))
  return sortSearchHits([...server, ...local.filter((hit) => !known.has(hit.id))])
}
