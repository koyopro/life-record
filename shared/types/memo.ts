import type { ItemStatus } from '~~/server/db/schema'

export type { ItemStatus }

/**
 * クイックメモの表示単位。
 *
 * Item は本文を持たないため、メモの内容は作成日の Section に入る
 * （docs/07-open-questions.md Q7）。一覧では両者をまとめて1件として扱う。
 */
export interface Memo {
  id: string
  title: string
  /** 作成時に書かれた本文。本文なしで作成された場合は null。 */
  body: string | null
  status: ItemStatus
  createdAt: string
  updatedAt: string
}

export interface CreateMemoInput {
  /** 1行目。空文字は不可。 */
  title: string
  /** 2行目以降。空なら Section を作らない。 */
  body?: string
}

/**
 * 入力テキストをタイトルと本文に分割する。
 *
 * 1行目をタイトル、2行目以降を本文として扱う。
 * サーバーとクライアントで解釈をそろえるため、ここに集約する。
 */
export function splitMemoInput(input: string): CreateMemoInput | null {
  const normalized = input.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return null

  const lineBreak = normalized.indexOf('\n')
  if (lineBreak === -1) {
    return { title: normalized }
  }

  const title = normalized.slice(0, lineBreak).trim()
  const body = normalized.slice(lineBreak + 1).trim()

  // 1行目が空（本文だけが書かれた）場合は、本文の先頭行をタイトルに繰り上げる
  if (!title) {
    return splitMemoInput(body)
  }

  return body ? { title, body } : { title }
}

export const MEMO_TITLE_MAX_LENGTH = 500
export const MEMO_BODY_MAX_LENGTH = 100_000
