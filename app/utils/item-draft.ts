import type { ItemDto } from '~~/shared/types/item'
import { todayDueAt } from '~~/shared/utils/date'
import { parseSmartAdd } from '~~/shared/utils/smart-add'
import { BODY_MAX_LENGTH, TITLE_MAX_LENGTH, splitInput } from '~~/shared/utils/text'

/**
 * 入力テキストから、追加する Item を組み立てる。
 *
 * 応答を待たずに一覧へ出すため、id と既定値はクライアントで決める。
 * サーバー（server/api/items.post.ts）と同じパーサ・同じ既定値
 * （status は未着手、期限は今日）を使うので、あとから届く内容と
 * 食い違わない。
 *
 * 一覧の入力欄と共有の受付（app/pages/share.vue）が同じ経路を通るように、
 * 組み立てはここに置く。
 */
export type DraftResult = { draft: ItemDto } | { error: string }

export interface DraftOptions {
  /** 「いま」。既定の期限（今日）と作成日時に使う。 */
  now?: Date
  /**
   * メモ（`Item.note`）。書き手が「これはメモ」と分かっている経路
   * （ブックマークレット。docs/17-bookmarklet.md）だけが渡す。
   *
   * 入力テキストの2行目以降（`body`）とは別物で、日付を持たないため
   * 日記には出ない（docs/02-data-model.md 2.3）。
   */
  note?: string | null
}

export function buildItemDraft(
  text: string,
  options: DraftOptions = {},
): DraftResult {
  const now = options.now ?? new Date()
  const note = options.note?.trim() || null
  const split = splitInput(text)
  const parsed = split ? parseSmartAdd(split.titleLine, now) : null

  if (!split || !parsed?.title) {
    return { error: 'タイトルが空です' }
  }
  if (parsed.title.length > TITLE_MAX_LENGTH) {
    return { error: `タイトルは ${TITLE_MAX_LENGTH} 文字までです` }
  }
  // メモの上限は作業記録の本文と同じ（docs/02-data-model.md 2.3）
  if (note && note.length > BODY_MAX_LENGTH) {
    return { error: `メモは ${BODY_MAX_LENGTH} 文字までです` }
  }

  return {
    draft: {
      id: crypto.randomUUID(),
      title: parsed.title,
      // 共有も含め、追加したものはまず未着手に入る
      status: 'backlog',
      priority: parsed.priority,
      url: parsed.url,
      // メモは普通は詳細から書くもの。渡ってきた経路だけが持つ
      note,
      // サーバー（items.post.ts）と同じく、期限の指定がなければ今日にする。
      // `^なし` / `^x` で明示的に外していれば、その指定に従う。
      dueAt: parsed.dueCleared ? null : (parsed.dueAt ?? todayDueAt(now)).toISOString(),
      dueHasTime: parsed.dueAt ? parsed.dueHasTime : false,
      body: split.body ?? null,
      tags: [...parsed.tags].sort(),
      recurrenceRule: parsed.recurrence?.rule ?? null,
      recurrenceBasis: parsed.recurrence?.basis ?? null,
      seriesId: null,
      completedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  }
}
