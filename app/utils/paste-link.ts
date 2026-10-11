import { isIframeUrl } from '~~/shared/utils/scrapbox/parse'

/**
 * 貼り付けた文字列を `[URL]` に変えるなら、その文字列を返す。変えないなら null
 * （docs/11-scrapbox-notation.md 11.11「URL の貼り付け」）。
 *
 * 埋め込みにするホスト（棋譜のページなど）の URL は、`[URL]` と囲むと
 * 埋め込みになる（11.12）。貼るたびに手で囲むのは手間なので、貼った時点で
 * 囲む。対象は埋め込みと同じ一覧（`isIframeUrl`）で、別には持たない。
 * 一覧が分かれると、囲んでも埋め込みにならない URL まで囲んでしまう。
 *
 * 変えるのは次のときだけ。
 * - 貼る先の行に、行頭（字下げ）以外の文字が無い
 * - 貼ったものが URL 1つだけで、埋め込みにするホストのもの
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
  return isIframeUrl(value) ? `[${value}]` : null
}
