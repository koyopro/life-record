import { SEARCH_EXCERPT_LENGTH } from '~~/shared/types/search'

/**
 * `ILIKE` のパターンを組み立てる。
 *
 * `%` `_` `\` は ILIKE のメタ文字なので、そのまま渡すと入力した文字と
 * 違うものに当たる。エスケープしてから前後に `%` を付ける。
 */
export function likePattern(query: string): string {
  const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`)
  return `%${escaped}%`
}

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
