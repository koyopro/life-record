/**
 * 空の行に URL を貼ったとき、角括弧で囲んで記法にするホスト
 * （docs/11-scrapbox-notation.md 11.11「URL の貼り付け」）。
 *
 * 棋譜のページは `[URL]` と囲むと埋め込みになる（11.12）。貼るたびに
 * 手で囲むのは手間なので、貼った時点で囲む。増やすときはこの1か所に足す。
 */
const BRACKET_ON_PASTE_HOSTS = ['kifu.tsumego.jp']

/**
 * 貼り付けた文字列を `[URL]` に変えるなら、その文字列を返す。変えないなら null。
 *
 * 変えるのは次のときだけ。
 * - 貼る先の行に、行頭（字下げ）以外の文字が無い
 * - 貼ったものが URL 1つだけで、ホストが `BRACKET_ON_PASTE_HOSTS` にある
 *
 * 文章の途中に貼ったときや、文章に混じった URL は変えない。貼った内容が
 * 変わってしまうため。
 *
 * @param pasted 貼り付けた文字列
 * @param lineContent 貼る先の行の中身（行頭は含まない）
 */
export function bracketPastedUrl(pasted: string, lineContent: string): string | null {
  if (lineContent.trim() !== '') return null

  const value = pasted.trim()
  if (!/^https?:\/\/\S+$/i.test(value)) return null

  try {
    const host = new URL(value).hostname.toLowerCase()
    return BRACKET_ON_PASTE_HOSTS.includes(host) ? `[${value}]` : null
  } catch {
    return null
  }
}
