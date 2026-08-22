import { beforeEach, describe, expect, it } from 'vitest'
import type { SectionDto } from '~~/shared/types/item'
import {
  getDiary,
  getSection,
  mergeServerDiary,
  mergeServerSections,
  mergeServerSectionsOnDate,
  putDiary,
  putSection,
  sectionsOfItem,
  sectionsOnDate,
  toLocalSection,
} from '~/utils/offline/body-repository'
import { resetLocalDatabase } from '../helpers'

/**
 * 本文（作業記録・日記）のローカル保管と、サーバーの内容の重ね方
 * （docs/12-offline.md 12.3 / docs/15-client-state.md 14.2）。
 */

const ITEM_ID = '00000000-0000-4000-8000-0000000000aa'

let counter = 0

function sectionDto(overrides: Partial<SectionDto> = {}): SectionDto {
  counter += 1
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    date: '2026-08-22',
    body: '書いたこと',
    position: 0,
    createdAt: '2026-08-22T09:00:00.000Z',
    updatedAt: '2026-08-22T09:00:00.000Z',
    ...overrides,
  }
}

describe('作業記録のローカル保管', () => {
  beforeEach(resetLocalDatabase)

  it('サーバーの内容をローカルへ写す', async () => {
    const section = sectionDto()
    await mergeServerSections(ITEM_ID, [section], '2026-08-22T10:00:00.000Z')

    const stored = await getSection(section.id)
    expect(stored?.body).toBe('書いたこと')
    expect(stored?.itemId).toBe(ITEM_ID)
    expect(stored?.syncState).toBe('synced')
  })

  it('まだ送れていない本文はサーバーの内容で上書きしない', async () => {
    const section = sectionDto({ body: 'もとの内容' })
    await mergeServerSections(ITEM_ID, [section], '2026-08-22T10:00:00.000Z')

    const local = await getSection(section.id)
    await putSection({ ...local!, body: 'オフラインで書いた', syncState: 'pending_save' })

    await mergeServerSections(ITEM_ID, [section], '2026-08-22T10:00:10.000Z')

    const after = await getSection(section.id)
    expect(after?.body).toBe('オフラインで書いた')
    expect(after?.syncState).toBe('pending_save')
  })

  it('保存より前に出した応答（＝古い取得）では上書きしない', async () => {
    const section = sectionDto({ body: '古い内容', updatedAt: '2026-08-22T10:00:00.000Z' })
    await mergeServerSections(ITEM_ID, [section], '2026-08-22T10:00:00.000Z')

    // 保存が通り、サーバーの更新日時が進んだ状態
    await putSection(
      toLocalSection(ITEM_ID, {
        ...section,
        body: '保存できた内容',
        updatedAt: '2026-08-22T10:00:05.000Z',
      }),
    )

    // 保存より前に出した取得の応答が、いま届いた
    await mergeServerSections(ITEM_ID, [section], '2026-08-22T10:00:03.000Z')

    expect((await getSection(section.id))?.body).toBe('保存できた内容')
  })

  it('サーバーに無くなった同期済みの記録は消す', async () => {
    const kept = sectionDto()
    const removed = sectionDto()
    await mergeServerSections(ITEM_ID, [kept, removed], '2026-08-22T10:00:00.000Z')

    await mergeServerSections(ITEM_ID, [kept], '2026-08-22T10:00:10.000Z')

    const ids = (await sectionsOfItem(ITEM_ID)).map((section) => section.id)
    expect(ids).toEqual([kept.id])
  })

  it('応答より後に保存した記録は、応答に無くても残す', async () => {
    const created = sectionDto({ updatedAt: '2026-08-22T10:00:05.000Z' })
    await putSection(toLocalSection(ITEM_ID, created))

    // その記録を作る前に出した応答が、いま届いた
    await mergeServerSections(ITEM_ID, [], '2026-08-22T10:00:03.000Z')

    expect(await getSection(created.id)).toBeDefined()
  })

  it('まだ送れていない記録は、応答に無くても残す', async () => {
    const draft = sectionDto()
    await putSection(toLocalSection(ITEM_ID, draft, 'pending_save'))

    await mergeServerSections(ITEM_ID, [], '2026-08-23T10:00:00.000Z')

    expect(await getSection(draft.id)).toBeDefined()
  })

  it('別の Item の記録には触らない', async () => {
    const other = sectionDto()
    await putSection(toLocalSection('00000000-0000-4000-8000-0000000000bb', other))

    await mergeServerSections(ITEM_ID, [], '2026-08-23T10:00:00.000Z')

    expect(await getSection(other.id)).toBeDefined()
  })

  it('日付から引ける（日記の「この日にやったこと」に使う）', async () => {
    await putSection(toLocalSection(ITEM_ID, sectionDto({ date: '2026-08-22' })))
    await putSection(toLocalSection(ITEM_ID, sectionDto({ date: '2026-08-21' })))

    const found = await sectionsOnDate('2026-08-22')
    expect(found.map((section) => section.date)).toEqual(['2026-08-22'])
  })
})

describe('日付ごとの重ね方（日記の「この日にやったこと」）', () => {
  beforeEach(resetLocalDatabase)

  const OTHER_ITEM = '00000000-0000-4000-8000-0000000000bb'

  it('他の端末で書かれた作業記録を、手元へ写す', async () => {
    const section = sectionDto({ date: '2026-08-22' })
    await mergeServerSectionsOnDate(
      '2026-08-22',
      [{ ...section, itemId: OTHER_ITEM }],
      '2026-08-22T10:00:00.000Z',
    )

    const stored = await getSection(section.id)
    expect(stored?.itemId).toBe(OTHER_ITEM)
    expect(stored?.syncState).toBe('synced')
    expect((await sectionsOnDate('2026-08-22')).map((s) => s.id)).toEqual([section.id])
  })

  it('別の日付の記録には触らない', async () => {
    const other = sectionDto({ date: '2026-08-21' })
    await putSection(toLocalSection(ITEM_ID, other))

    await mergeServerSectionsOnDate('2026-08-22', [], '2026-08-22T10:00:00.000Z')

    expect(await getSection(other.id)).toBeDefined()
  })

  it('その日の記録が他の端末で消えていれば、手元からも消す', async () => {
    const removed = sectionDto({ date: '2026-08-22' })
    await putSection(toLocalSection(ITEM_ID, removed))

    await mergeServerSectionsOnDate('2026-08-22', [], '2026-08-22T10:00:10.000Z')

    expect(await getSection(removed.id)).toBeUndefined()
  })

  it('まだ送れていない記録は、応答に無くても残す', async () => {
    const draft = sectionDto({ date: '2026-08-22' })
    await putSection(toLocalSection(ITEM_ID, draft, 'pending_save'))

    await mergeServerSectionsOnDate('2026-08-22', [], '2026-08-22T10:00:10.000Z')

    expect(await getSection(draft.id)).toBeDefined()
  })
})

describe('日記のローカル保管', () => {
  beforeEach(resetLocalDatabase)

  it('サーバーの内容をローカルへ写す', async () => {
    await mergeServerDiary(
      '2026-08-22',
      { body: '今日のこと', updatedAt: '2026-08-22T10:00:00.000Z' },
      '2026-08-22T10:00:00.000Z',
    )

    const stored = await getDiary('2026-08-22')
    expect(stored?.body).toBe('今日のこと')
    expect(stored?.syncState).toBe('synced')
  })

  it('まだ送れていない本文は上書きしない', async () => {
    await putDiary({
      date: '2026-08-22',
      body: 'オフラインで書いた',
      updatedAt: null,
      syncState: 'pending_save',
    })

    await mergeServerDiary(
      '2026-08-22',
      { body: 'サーバーの内容', updatedAt: '2026-08-22T10:00:00.000Z' },
      '2026-08-22T10:00:00.000Z',
    )

    expect((await getDiary('2026-08-22'))?.body).toBe('オフラインで書いた')
  })

  it('保存より前に出した応答では上書きしない', async () => {
    await putDiary({
      date: '2026-08-22',
      body: '保存できた内容',
      updatedAt: '2026-08-22T10:00:05.000Z',
      syncState: 'synced',
    })

    await mergeServerDiary(
      '2026-08-22',
      { body: '古い内容', updatedAt: '2026-08-22T10:00:00.000Z' },
      '2026-08-22T10:00:03.000Z',
    )

    expect((await getDiary('2026-08-22'))?.body).toBe('保存できた内容')
  })

  it('他の端末で書かれた新しい内容は採る', async () => {
    await putDiary({
      date: '2026-08-22',
      body: 'こちらで書いた内容',
      updatedAt: '2026-08-22T10:00:00.000Z',
      syncState: 'synced',
    })

    await mergeServerDiary(
      '2026-08-22',
      { body: '別の端末で書いた内容', updatedAt: '2026-08-22T11:00:00.000Z' },
      '2026-08-22T11:00:01.000Z',
    )

    expect((await getDiary('2026-08-22'))?.body).toBe('別の端末で書いた内容')
  })
})
