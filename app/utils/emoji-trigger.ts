/**
 * `:` の候補（絵文字・アイコン）を出すかの判定
 * （docs/11-scrapbox-notation.md 11.8「入力（`:` の候補）」）。
 */

/** 候補を出すときの、`:` の位置と、その後ろに打った文字（探す語）。 */
export interface EmojiTrigger {
  start: number
  query: string
}

/**
 * カーソルより前の文字から、候補を出すかを決める。出さないなら null。
 *
 * 出すのは、**`:` の直前が空白か行頭**のときだけ。`9:30` の時刻や
 * `https:` のように、語の途中の `:` で候補が開くと、書いている途中で
 * 「該当する絵文字・アイコンがありません」が出て邪魔になる。
 * `:` から後ろに空白を打ったら、名前の入力は終わったものとして閉じる。
 *
 * @param before 編集中の行の、カーソルより前の中身（行頭の字下げは含まない）
 */
export function emojiTriggerAt(before: string): EmojiTrigger | null {
  const at = before.lastIndexOf(':')
  if (at === -1) return null

  // 直前に文字がくっついている `:` は、語の一部（時刻・URL など）
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null

  const query = before.slice(at + 1)
  if (/\s/.test(query)) return null

  return { start: at, query }
}
