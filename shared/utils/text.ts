export const TITLE_MAX_LENGTH = 500
export const BODY_MAX_LENGTH = 100_000

export interface SplitInput {
  /** 1行目。SmartAdd の記法はこの行に書く。 */
  titleLine: string
  /** 2行目以降。空なら undefined。 */
  body?: string
}

/**
 * 入力テキストを1行目と2行目以降に分割する。
 *
 * クイックメモでは1行目がタイトル、2行目以降が Section の本文になる
 * （docs/07-open-questions.md Q7）。サーバーとクライアントで解釈を
 * そろえるため、ここに集約する。
 */
export function splitInput(input: string): SplitInput | null {
  const normalized = input.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return null

  const lineBreak = normalized.indexOf('\n')
  if (lineBreak === -1) {
    return { titleLine: normalized }
  }

  const titleLine = normalized.slice(0, lineBreak).trim()
  const body = normalized.slice(lineBreak + 1).trim()

  // 1行目が空（本文だけが書かれた）場合は、本文の先頭行を繰り上げる
  if (!titleLine) return splitInput(body)

  return body ? { titleLine, body } : { titleLine }
}
