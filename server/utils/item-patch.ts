import {
  URL_MAX_LENGTH,
  isItemStatus,
  isOpenableUrl,
  isPriority,
  type ItemPatch,
} from '~~/shared/types/item'
import { isRecurrenceBasis, type RecurrenceBasis } from '~~/shared/types/recurrence'
import { isValidRule } from '~~/shared/utils/recurrence'
import { TITLE_MAX_LENGTH } from '~~/shared/utils/text'

export interface ItemUpdateValues {
  title?: string
  url?: string | null
  status?: ItemPatch['status']
  priority?: number | null
  dueAt?: Date | null
  dueHasTime?: boolean
  recurrenceRule?: string | null
  recurrenceBasis?: RecurrenceBasis | null
  /**
   * 完了にした日時。status の遷移から決まるので、ここでは検証しない
   * （items.patch.ts が、更新前の状態を見て個別に設定する）。
   */
  completedAt?: Date | null
  updatedAt: Date
}

/**
 * リクエストの patch を検証し、DB に渡す値へ変換する。
 *
 * 指定されなかった項目は変更しない。null は「値を消す」を意味する。
 */
export function toUpdateValues(patch: unknown): ItemUpdateValues {
  if (typeof patch !== 'object' || patch === null) {
    throw createError({ statusCode: 400, message: '不正な内容です' })
  }

  const input = patch as Record<string, unknown>
  const values: ItemUpdateValues = { updatedAt: new Date() }

  if ('title' in input) {
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (!title) {
      throw createError({
        statusCode: 400,
        message: 'タイトルは空にできません',
      })
    }
    if (title.length > TITLE_MAX_LENGTH) {
      throw createError({
        statusCode: 400,
        message: `タイトルは ${TITLE_MAX_LENGTH} 文字までです`,
      })
    }
    values.title = title
  }

  if ('url' in input) {
    if (input.url === null || input.url === '') {
      values.url = null
    } else if (typeof input.url === 'string') {
      const url = input.url.trim()
      if (url.length > URL_MAX_LENGTH) {
        throw createError({
          statusCode: 400,
          message: `URL は ${URL_MAX_LENGTH} 文字までです`,
        })
      }
      // 別タブで開く先なので、保存の時点で http(s) 以外は通さない
      if (!isOpenableUrl(url)) {
        throw createError({
          statusCode: 400,
          message: 'URL は http:// か https:// で始まる必要があります',
        })
      }
      values.url = url
    } else {
      throw createError({ statusCode: 400, message: '不正な URL です' })
    }
  }

  if ('status' in input) {
    if (!isItemStatus(input.status)) {
      throw createError({ statusCode: 400, message: '不正な status です' })
    }
    values.status = input.status
  }

  if ('priority' in input) {
    if (input.priority === null) {
      values.priority = null
    } else if (isPriority(input.priority)) {
      values.priority = input.priority
    } else {
      throw createError({
        statusCode: 400,
        message: '重要度は 1〜3 か null です',
      })
    }
  }

  if ('dueAt' in input) {
    if (input.dueAt === null) {
      values.dueAt = null
      // 期限を消したら時刻指定の有無も意味を失う
      values.dueHasTime = false
    } else if (typeof input.dueAt === 'string') {
      const date = new Date(input.dueAt)
      if (Number.isNaN(date.getTime())) {
        throw createError({
          statusCode: 400,
          message: '不正な期限です',
        })
      }
      values.dueAt = date
    } else {
      throw createError({ statusCode: 400, message: '不正な期限です' })
    }
  }

  // 繰り返しは rule と basis をひとまとまりで扱う。
  // DB の CHECK 制約と同じく、片方だけの状態を作らせない。
  if ('recurrenceRule' in input || 'recurrenceBasis' in input) {
    const rule = input.recurrenceRule
    const basis = input.recurrenceBasis

    if (rule === null || rule === undefined) {
      values.recurrenceRule = null
      values.recurrenceBasis = null
    } else {
      if (typeof rule !== 'string' || !isValidRule(rule)) {
        throw createError({
          statusCode: 400,
          message: '繰り返しの規則が不正です',
        })
      }
      if (!isRecurrenceBasis(basis)) {
        throw createError({
          statusCode: 400,
          message: '繰り返しの起点が不正です',
        })
      }
      values.recurrenceRule = rule
      values.recurrenceBasis = basis
    }
  }

  if ('dueHasTime' in input && values.dueHasTime === undefined) {
    if (typeof input.dueHasTime !== 'boolean') {
      throw createError({
        statusCode: 400,
        message: '不正な dueHasTime です',
      })
    }
    values.dueHasTime = input.dueHasTime
  }

  // updatedAt だけなら変更内容がない
  if (Object.keys(values).length === 1) {
    throw createError({
      statusCode: 400,
      message: '変更内容がありません',
    })
  }

  return values
}
