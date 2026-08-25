import { DIARY_EXCERPT_LENGTH, WORKED_ON_HEAD_LINES } from '~~/shared/types/diary'
import { firstImageSrc } from '~~/shared/utils/scrapbox/parse'
import { toPlainText } from '~~/shared/utils/scrapbox/render'

/**
 * 一覧に出す抜粋。
 *
 * カレンダーの枠内にそのまま表示するため、記法を除いたプレーンテキストにする。
 *
 * 画面と API の両方で使う。書いた直後の一覧は、取り直しを待たずに
 * ストアの控えから同じ抜粋を作って出す（docs/15-client-state.md）。
 */
export function excerptOf(body: string): string {
  const text = toPlainText(body)
  if (text.length <= DIARY_EXCERPT_LENGTH) return text
  return `${text.slice(0, DIARY_EXCERPT_LENGTH)}…`
}

/**
 * ピン留めした作業記録から、カレンダーのサムネイルに使う画像を選ぶ。
 *
 * 渡すのは**日記の画面に並ぶ順**（上に出ているものが先）のピン留めの本文で、
 * 最初に見つかった画像を使う。上から順に見るので、「上に出ている作業記録が
 * 優先」になる（docs/03-functional-spec.md 3.3）。
 *
 * サーバー（一覧の API）とクライアント（手元の控え）の両方から使い、
 * どちらで作っても同じ絵が出るようにする。
 */
export function pinnedImageOf(bodies: string[]): string | null {
  for (const body of bodies) {
    const found = firstImageSrc(body)
    if (found) return found
  }
  return null
}

export interface BodyHead {
  /** 冒頭の数行。記法はそのまま（表示側で解釈する）。 */
  text: string
  /** 続きがあるか。画面に「まだ先がある」ことを出すために使う。 */
  truncated: boolean
}

/**
 * 本文の冒頭だけを取り出す。
 *
 * 日記の「この日にやったこと」に作業記録を添えるときに使う
 * （docs/03-functional-spec.md 3.3）。記法は落とさない。落とすと、
 * 箇条書きや画像がただの文字になって読みにくくなるため。
 */
export function headOf(body: string, limit = WORKED_ON_HEAD_LINES): BodyHead {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const head = lines.slice(0, limit)

  // 末尾の空行は出さない（枠だけが伸びて見える）
  while (head.length > 0 && !head[head.length - 1]!.trim()) head.pop()

  return {
    text: head.join('\n'),
    truncated: lines.slice(limit).some((line) => line.trim().length > 0),
  }
}
