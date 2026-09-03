import {
  continuationPrefix,
  iframeNotation,
  parseScrapbox,
} from '~~/shared/utils/scrapbox/parse'
import type { Caret } from './caret-shift'

/**
 * 埋め込み（`iframe:URL`）を本文のどこへ差し込むか
 * （docs/11-scrapbox-notation.md 11.12）。
 *
 * 押した時点のカーソルの位置に入れる。ただし**必ず1行として置く**。
 * `iframe:` は行の種類を決める行頭なので、書きかけの文の後ろに続けると
 * 埋め込みとして読まれない（画像は行の末尾ならその行に続けるが、
 * こちらはそれができない）。
 *
 * 画面から切り離してここに置くのは、行の組み立てをテストできるようにするため。
 */

export interface IframeInsert {
  lines: string[]
  /** 埋め込みの行の番号。 */
  index: number
  /** 差し込みで増えた行数。 */
  added: number
}

export function insertIframeLines(
  source: string[],
  at: Caret | null,
  url: string,
): IframeInsert {
  const lines = [...source]
  const notation = iframeNotation(url)

  if (!at || at.index < 0 || at.index >= lines.length) {
    lines.push(notation)
    return { lines, index: lines.length - 1, added: 1 }
  }

  const parsed = parseScrapbox(lines.join('\n'))
  const line = parsed[Math.min(Math.max(at.index, 0), parsed.length - 1)]!
  const offset = Math.min(Math.max(at.offset, 0), line.content.length)
  const before = line.content.slice(0, offset)
  const after = line.content.slice(offset)
  const prefix = continuationPrefix(line)

  /*
   * カーソルのある行を「前・埋め込み・後ろ」に割る。文字が残らない側は
   * 作らない（空行が増えるだけなので）。何も書かれていない行に入れたときは
   * その行がそのまま埋め込みになる。
   */
  const replacement = [
    ...(before ? [line.prefix + before] : []),
    prefix + notation,
    ...(after ? [prefix + after] : []),
  ]
  lines.splice(at.index, 1, ...replacement)

  return {
    lines,
    index: at.index + (before ? 1 : 0),
    added: replacement.length - 1,
  }
}
