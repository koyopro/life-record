import { beforeEach, describe, expect, it } from 'vitest'
import { linkTodoTitleEverywhere } from '~/utils/offline/todo-link-actions'
import { getDiary, getSection, putDiary, putSection } from '~/utils/offline/body-repository'
import { getItem, putItem, toLocalItem } from '~/utils/offline/todo-repository'
import { listOperations } from '~/utils/offline/sync-queue'
import { itemDto, resetLocalDatabase } from '../helpers'

/**
 * `[題]` のリンク先が決まったとき、手元の写しにある同じ `[題]` もまとめて
 * 書き換え、サーバーにしか無い分のために操作を積む
 * （docs/11-scrapbox-notation.md 11.13）。
 */

const TODO_ID = '00000000-0000-4000-8000-0000000000aa'
const OTHER_ID = '00000000-0000-4000-8000-0000000000bb'
const SECTION_ID = '00000000-0000-4000-8000-000000000001'
const link = `[/items/${TODO_ID} インフルエンザ]`

describe('linkTodoTitleEverywhere', () => {
  beforeEach(async () => {
    await resetLocalDatabase()
  })

  it('日記・作業記録・メモの `[題]` を、同期状態を変えずに書き換える', async () => {
    await putDiary({
      date: '2026-10-01',
      body: '熱 [インフルエンザ]',
      updatedAt: '2026-10-01T00:00:00.000Z',
      syncState: 'synced',
    })
    await putDiary({
      date: '2026-10-02',
      body: '[インフルエンザ] 2日目',
      updatedAt: null,
      syncState: 'pending_save',
    })
    await putSection({
      id: SECTION_ID,
      itemId: OTHER_ID,
      date: '2026-10-03',
      body: '[インフルエンザ]の予防接種',
      position: 0,
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
      syncState: 'synced',
    } as Parameters<typeof putSection>[0])
    await putItem(toLocalItem(itemDto({ id: OTHER_ID, note: 'メモ [インフルエンザ]' })))

    const changed = await linkTodoTitleEverywhere(TODO_ID, 'インフルエンザ')

    expect(changed).toBe(4)
    expect(await getDiary('2026-10-01')).toMatchObject({
      body: `熱 ${link}`,
      syncState: 'synced',
    })
    expect(await getDiary('2026-10-02')).toMatchObject({
      body: `${link} 2日目`,
      syncState: 'pending_save',
    })
    expect((await getSection(SECTION_ID))?.body).toBe(`${link}の予防接種`)
    expect((await getItem(OTHER_ID))?.note).toBe(`メモ ${link}`)

    const operations = await listOperations()
    expect(operations).toHaveLength(1)
    expect(operations[0]).toMatchObject({
      kind: 'todo_link',
      itemIds: [],
      payload: { itemId: TODO_ID, title: 'インフルエンザ' },
    })
  })

  it('未送信の変更があるメモは書き換えない', async () => {
    await putItem({
      ...toLocalItem(itemDto({ id: OTHER_ID, note: '[インフルエンザ]' })),
      syncState: 'pending_update',
    })

    expect(await linkTodoTitleEverywhere(TODO_ID, 'インフルエンザ')).toBe(0)
    expect((await getItem(OTHER_ID))?.note).toBe('[インフルエンザ]')
  })
})
