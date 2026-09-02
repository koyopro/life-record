import { describe, expect, it } from 'vitest'
import { isLinkablePath } from '~~/shared/types/backlink'
import { diaryMonthPath } from '~~/shared/utils/diary-month'

/**
 * バックリンクを引ける入口の絞り込み（server/api/backlinks.get.ts）。
 *
 * バックリンクは本文の部分一致で引くので、任意の文字列を受けると
 * 「本文の検索」を別の入口から呼べてしまう。記法が認めるパスだけを通す。
 */
describe('バックリンクを引けるパス', () => {
  const ITEM_ID = '93179db9-bbe9-4c3c-87e9-0fd385a281f9'

  it('タスク・日記・月のページを受ける', () => {
    expect(isLinkablePath(`/items/${ITEM_ID}`)).toBe(true)
    expect(isLinkablePath('/diary/2026-09-01')).toBe(true)
    expect(isLinkablePath('/diary/month/2026-09')).toBe(true)
  })

  it('リンクとして書けない形は受けない', () => {
    expect(isLinkablePath('/items/not-a-uuid')).toBe(false)
    // 月のページは `month/` を挟む形だけ
    expect(isLinkablePath('/diary/2026-09')).toBe(false)
    expect(isLinkablePath('/')).toBe(false)
    expect(isLinkablePath('')).toBe(false)
    expect(isLinkablePath(undefined)).toBe(false)
  })

  it('前後に何か付いた形は受けない（部分一致の当たり方が変わるため）', () => {
    expect(isLinkablePath('/diary/month/2026-09/')).toBe(false)
    expect(isLinkablePath('/diary/month/2026-09?x=1')).toBe(false)
    expect(isLinkablePath('%/diary/month/2026-09%')).toBe(false)
  })

  it('画面が組み立てるパスは、そのまま受けられる', () => {
    expect(isLinkablePath(diaryMonthPath('2026-09'))).toBe(true)
  })
})
