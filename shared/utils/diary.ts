import { DIARY_EXCERPT_LENGTH } from '~~/shared/types/diary'
import { toPlainText } from '~~/shared/utils/scrapbox/render'

/**
 * 一覧に出す抜粋。
 *
 * カレンダーの枠内にそのまま表示するため、記法を除いたプレーンテキストにする。
 *
 * 画面と API の両方で使う。書いた直後の一覧は、取り直しを待たずに
 * ストアの控えから同じ抜粋を作って出す（docs/14-client-state.md）。
 */
export function excerptOf(body: string): string {
  const text = toPlainText(body)
  if (text.length <= DIARY_EXCERPT_LENGTH) return text
  return `${text.slice(0, DIARY_EXCERPT_LENGTH)}…`
}
