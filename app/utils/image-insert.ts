import { continuationPrefix, parseScrapbox } from '~~/shared/utils/scrapbox/parse'
import type { Caret, LineSplit } from './caret-shift'

/**
 * 画像を本文のどこへ差し込むか（docs/11-scrapbox-notation.md 11.7「挿入する位置」）。
 *
 * 貼った（落とした）ときのカーソルの位置に入れる。**行の末尾に入れるときは
 * 行を割らない**（末尾なら、割っても後ろに回る文字が無い。それでも割ると、
 * 書いた文と画像のあいだに空の改行が入ってしまう）。行の途中では、書きかけの
 * 文が画像記法で割られないよう、これまでどおり1行として置く。
 *
 * 画面から切り離してここに置くのは、行の組み立てをテストできるようにするため。
 */

export interface ImageInsert {
  lines: string[]
  /** 画像の次（続きを書く場所）。 */
  at: Caret
  /**
   * どの行をどこで割ったか。割っていなければ null。
   *
   * 上げている間も書き続けている人のカーソルを、見た目の同じ場所に
   * 留めるために使う（`caretAfterSplit`）。
   */
  split: LineSplit | null
  /** 差し込みで増えた行数。 */
  added: number
}

/** 画像の記法。上げ終わったパス（URL）をそのまま囲む。 */
export function imageNotation(path: string): string {
  return `[${path}]`
}

export function insertImageLines(
  source: string[],
  at: Caret | null,
  path: string,
): ImageInsert {
  const lines = [...source]
  const image = imageNotation(path)

  if (!at || at.index < 0 || at.index >= lines.length) {
    lines.push(image)
    // 末尾に足しただけなので、いまある行の番号は動かない
    return { lines, at: { index: lines.length, offset: 0 }, split: null, added: 0 }
  }

  const parsed = parseScrapbox(lines.join('\n'))
  const line = parsed[Math.min(Math.max(at.index, 0), parsed.length - 1)]!
  const offset = Math.min(Math.max(at.offset, 0), line.content.length)
  const before = line.content.slice(0, offset)
  const after = line.content.slice(offset)
  const prefix = continuationPrefix(line)

  /*
   * 行の末尾に入れるときは、その行へ続けて置く。
   *
   * 割っても後ろへ回る文字は無いので、割ると**書いた文と画像のあいだに
   * 空の改行が入るだけ**になる。文字とのあいだには半角スペースを1つ置く
   * （すでに空白で終わっていれば足さない）。
   */
  if (before && !after) {
    const separator = /\s$/.test(before) ? '' : ' '
    lines.splice(at.index, 1, line.prefix + before + separator + image)
    return {
      lines,
      // 続きは次の行から（画像の入った行へ戻すと、記法が生のまま出てくる）
      at: { index: at.index + 1, offset: 0 },
      split: null,
      added: 0,
    }
  }

  const replacement = [
    ...(before ? [line.prefix + before] : []),
    prefix + image,
    ...(after ? [prefix + after] : []),
  ]
  lines.splice(at.index, 1, ...replacement)

  return {
    lines,
    // 差し込んだ画像の行（before があれば1つ下）の、さらに次
    at: { index: at.index + (before ? 1 : 0) + 1, offset: 0 },
    split: { index: at.index, offset, hasBefore: Boolean(before) },
    added: replacement.length - 1,
  }
}
