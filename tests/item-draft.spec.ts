import { describe, expect, it } from 'vitest'
import { buildItemDraft } from '~/utils/item-draft'
import { composeShare } from '~~/shared/utils/share'
import { TITLE_MAX_LENGTH } from '~~/shared/utils/text'

/**
 * 追加する Item の組み立て。
 *
 * 一覧の入力欄と共有の受付（app/pages/share.vue）が同じ経路を通るため、
 * 共有された内容がどう Item になるかもここで確かめる。
 */
describe('buildItemDraft', () => {
  it('共有された URL とタイトルから、未着手の Item を組み立てる', () => {
    const composed = composeShare({
      url: 'https://example.com/blog/entry',
      title: 'Example Page',
      text: '引用したい一節',
    })
    const result = buildItemDraft(composed.text)

    expect('draft' in result).toBe(true)
    if (!('draft' in result)) return

    expect(result.draft.status).toBe('backlog')
    expect(result.draft.title).toBe('Example Page')
    expect(result.draft.url).toBe('https://example.com/blog/entry')
    expect(result.draft.body).toBe('引用したい一節')
    // 期限は一覧からの追加と同じ既定（今日）
    expect(result.draft.dueAt).not.toBeNull()
  })

  it('タイトルが無い共有でも保存できる（URL から作る）', () => {
    const composed = composeShare({ url: 'https://example.com/a' })
    const result = buildItemDraft(composed.text)

    expect(result).toMatchObject({
      draft: { title: 'example.com/a', url: 'https://example.com/a', status: 'backlog' },
    })
  })

  it('SmartAdd の記法は共有からの保存でも効く', () => {
    const result = buildItemDraft('あとで読む !1 #記事 https://example.com/a')

    expect(result).toMatchObject({
      draft: { title: 'あとで読む', priority: 1, tags: ['記事'] },
    })
  })

  it('^なし / ^x を書けば、既定の今日を当てずに期限なしで作る', () => {
    const withNashi = buildItemDraft('観葉植物を見に行く ^なし')
    expect(withNashi).toMatchObject({
      draft: { title: '観葉植物を見に行く', dueAt: null },
    })

    const withX = buildItemDraft('観葉植物を見に行く ^x')
    expect(withX).toMatchObject({
      draft: { title: '観葉植物を見に行く', dueAt: null },
    })
  })

  it('中身が無ければ組み立てない', () => {
    expect(buildItemDraft('   ')).toEqual({ error: 'タイトルが空です' })
  })

  it('長すぎるタイトルは断る', () => {
    const result = buildItemDraft('あ'.repeat(TITLE_MAX_LENGTH + 1))

    expect(result).toEqual({
      error: `タイトルは ${TITLE_MAX_LENGTH} 文字までです`,
    })
  })
})
