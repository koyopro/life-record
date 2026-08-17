import { isItemStatus, isPriority, type ItemPatch } from '~~/shared/types/item'
import { TITLE_MAX_LENGTH } from '~~/shared/utils/text'

export interface ItemUpdateValues {
  title?: string
  status?: ItemPatch['status']
  priority?: number | null
  dueAt?: Date | null
  dueHasTime?: boolean
  updatedAt: Date
}

/**
 * リクエストの patch を検証し、DB に渡す値へ変換する。
 *
 * 指定されなかった項目は変更しない。null は「値を消す」を意味する。
 */
export function toUpdateValues(patch: unknown): ItemUpdateValues {
  if (typeof patch !== 'object' || patch === null) {
    throw createError({ statusCode: 400, statusMessage: '不正な内容です' })
  }

  const input = patch as Record<string, unknown>
  const values: ItemUpdateValues = { updatedAt: new Date() }

  if ('title' in input) {
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (!title) {
      throw createError({
        statusCode: 400,
        statusMessage: 'タイトルは空にできません',
      })
    }
    if (title.length > TITLE_MAX_LENGTH) {
      throw createError({
        statusCode: 400,
        statusMessage: `タイトルは ${TITLE_MAX_LENGTH} 文字までです`,
      })
    }
    values.title = title
  }

  if ('status' in input) {
    if (!isItemStatus(input.status)) {
      throw createError({ statusCode: 400, statusMessage: '不正な status です' })
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
        statusMessage: '重要度は 1〜3 か null です',
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
          statusMessage: '不正な期限です',
        })
      }
      values.dueAt = date
    } else {
      throw createError({ statusCode: 400, statusMessage: '不正な期限です' })
    }
  }

  if ('dueHasTime' in input && values.dueHasTime === undefined) {
    if (typeof input.dueHasTime !== 'boolean') {
      throw createError({
        statusCode: 400,
        statusMessage: '不正な dueHasTime です',
      })
    }
    values.dueHasTime = input.dueHasTime
  }

  // updatedAt だけなら変更内容がない
  if (Object.keys(values).length === 1) {
    throw createError({
      statusCode: 400,
      statusMessage: '変更内容がありません',
    })
  }

  return values
}
