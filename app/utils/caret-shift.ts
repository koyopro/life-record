/**
 * 行を差し替えたあとに、カーソルがどこへ移るか（ScrapboxEditor）。
 *
 * 画像の差し込みは1行を「前・画像・後ろ」に割るので、その下の行は番号が
 * ずれ、割った行の中にいたカーソルは前後どちらかへ振り分けられる。
 * **書いている人のカーソルを、見た目の同じ場所に留めておく**ために使う
 * （docs/11-scrapbox-notation.md 11.7「挿入する位置」）。
 */

export interface Caret {
  index: number
  offset: number
}

/** 1行を割って何かを差し込んだ、という事実。 */
export interface LineSplit {
  /** 割った行。 */
  index: number
  /** 行の中のどこで割ったか（行頭を除いた文字数）。 */
  offset: number
  /** 割った位置より前に文字が残ったか（残っていれば、差し込んだ行は1つ下）。 */
  hasBefore: boolean
}

/**
 * 割る前のカーソル位置を、割った後の位置に読み替える。
 *
 * - 割った行より上 … そのまま
 * - 割った行より下 … 増えた行数だけ下へ
 * - 割った行の中 … 割った位置より後ろにいたなら、後ろ半分の行の同じ文字へ。
 *   前にいたなら前半分の行に残る（前半分が無い＝行頭で割ったときは、
 *   後ろ半分の行の先頭へ）
 */
export function caretAfterSplit(caret: Caret, split: LineSplit, added: number): Caret {
  if (caret.index < split.index) return caret
  if (caret.index > split.index) return { ...caret, index: caret.index + added }

  // 割った位置より後ろにいた文字は、後ろ半分の行へ回る
  if (caret.offset > split.offset) {
    return {
      index: split.index + (split.hasBefore ? 1 : 0) + 1,
      offset: caret.offset - split.offset,
    }
  }

  // 前半分が無い（行頭で割った）なら、残っている文字は後ろ半分の行にある
  if (!split.hasBefore) return { index: split.index + 1, offset: 0 }

  return { index: split.index, offset: caret.offset }
}
