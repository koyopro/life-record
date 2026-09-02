import type { SectionDto } from '~~/shared/types/item'
import type { DiarySectionDto } from '~~/shared/types/diary'
import { keepsLocal } from './freshness'
import {
  openLocalDatabase,
  type BodySyncState,
  type LocalDiary,
  type LocalSection,
} from './local-database'

/**
 * 本文（作業記録＝Section と日記）のローカル保管。
 *
 * TODO（todo-repository）と同じ考え方で、IndexedDB への読み書きをここへ集める。
 * 画面は `useItemDetailStore` / `useDiaryStore` を通してしか触らない。
 *
 * サーバーから取り直した内容の重ね方は、種類をまたいで同じ決まり
 * （`freshness.ts` の `keepsLocal`）に従う。
 */

// --- 作業記録（Section） ------------------------------------------------

export function toLocalSection(
  itemId: string,
  section: SectionDto,
  syncState: BodySyncState = 'synced',
): LocalSection {
  return {
    id: section.id,
    itemId,
    date: section.date,
    body: section.body,
    position: section.position,
    // 古い写しには無い（この機能より前に入れた分）。無ければ立っていない扱い
    pinned: section.pinned === true,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    syncState,
  }
}

/** その Item の作業記録。並べ替えは呼び出し側（section-order）が行う。 */
export async function sectionsOfItem(itemId: string): Promise<LocalSection[]> {
  const db = await openLocalDatabase()
  return await db.getAllFromIndex('sections', 'by-item', itemId)
}

/** その日付の作業記録。日記の「この日にやったこと」を手元で作るのに使う。 */
export async function sectionsOnDate(date: string): Promise<LocalSection[]> {
  const db = await openLocalDatabase()
  return await db.getAllFromIndex('sections', 'by-date', date)
}

export async function getSection(id: string): Promise<LocalSection | undefined> {
  const db = await openLocalDatabase()
  return await db.get('sections', id)
}

export async function putSection(section: LocalSection): Promise<void> {
  const db = await openLocalDatabase()
  await db.put('sections', section)
}

export async function deleteSection(id: string): Promise<void> {
  const db = await openLocalDatabase()
  await db.delete('sections', id)
}

/** まだ送れていない作業記録。起動時の積み直しに使う。 */
export async function pendingSections(): Promise<LocalSection[]> {
  const db = await openLocalDatabase()
  const all = await db.getAll('sections')
  return all.filter((section) => section.syncState !== 'synced')
}

/**
 * サーバーから取り直した作業記録を、その Item の分だけ重ねる。
 *
 * 応答に無い記録は、他の端末で消されたものとして落とす。ただし未送信の分と、
 * 応答より後に保存した分（＝その応答がまだ知らない記録）は残す。
 */
export async function mergeServerSections(
  itemId: string,
  server: SectionDto[],
  fetchedAt: string,
): Promise<void> {
  const db = await openLocalDatabase()
  const tx = db.transaction('sections', 'readwrite')
  const index = tx.store.index('by-item')

  const locals = new Map<string, LocalSection>()
  for (const local of await index.getAll(itemId)) locals.set(local.id, local)

  const seen = new Set<string>()
  for (const section of server) {
    seen.add(section.id)
    const local = locals.get(section.id)
    if (local && keepsLocal(local, fetchedAt)) continue
    await tx.store.put(toLocalSection(itemId, section))
  }

  for (const [id, local] of locals) {
    if (seen.has(id)) continue
    if (keepsLocal(local, fetchedAt)) continue
    await tx.store.delete(id)
  }

  await tx.done
}

/**
 * サーバーから取り直した作業記録を、その日付の分だけ重ねる。
 *
 * 日記の「この日にやったこと」は手元の作業記録から作るので、他の端末で
 * 書かれた分もここで受け取る（docs/12-offline.md 12.4）。Item ごとの
 * `mergeServerSections` と違い、**同じ日付**を単位に重ねる（応答に入って
 * いるのはその日の分だけなので、他の日の記録には触らない）。
 */
export async function mergeServerSectionsOnDate(
  date: string,
  server: DiarySectionDto[],
  fetchedAt: string,
): Promise<void> {
  const db = await openLocalDatabase()
  const tx = db.transaction('sections', 'readwrite')
  const index = tx.store.index('by-date')

  const locals = new Map<string, LocalSection>()
  for (const local of await index.getAll(date)) locals.set(local.id, local)

  const seen = new Set<string>()
  for (const section of server) {
    seen.add(section.id)
    const local = locals.get(section.id)
    if (local && keepsLocal(local, fetchedAt)) continue
    await tx.store.put(toLocalSection(section.itemId, section))
  }

  for (const [id, local] of locals) {
    if (seen.has(id)) continue
    if (keepsLocal(local, fetchedAt)) continue
    await tx.store.delete(id)
  }

  await tx.done
}

// --- 日記 ---------------------------------------------------------------

export async function getDiary(date: string): Promise<LocalDiary | undefined> {
  const db = await openLocalDatabase()
  return await db.get('diaries', date)
}

export async function putDiary(diary: LocalDiary): Promise<void> {
  const db = await openLocalDatabase()
  await db.put('diaries', diary)
}

/** 手元にある日記。カレンダー（一覧）の抜粋にも使う。 */
export async function allDiaries(): Promise<LocalDiary[]> {
  const db = await openLocalDatabase()
  return await db.getAll('diaries')
}

/** まだ送れていない日記。起動時の積み直しに使う。 */
export async function pendingDiaries(): Promise<LocalDiary[]> {
  const db = await openLocalDatabase()
  const all = await db.getAll('diaries')
  return all.filter((diary) => diary.syncState !== 'synced')
}

/**
 * サーバーから取り直した日記を重ねる。
 *
 * まだ書かれていない日は、本文が空・`updatedAt` が null で届く。
 */
export async function mergeServerDiary(
  date: string,
  server: { body: string; updatedAt: string | null },
  fetchedAt: string,
): Promise<void> {
  const db = await openLocalDatabase()
  const tx = db.transaction('diaries', 'readwrite')
  const local = await tx.store.get(date)

  if (!local || !keepsLocal(local, fetchedAt)) {
    await tx.store.put({
      date,
      body: server.body,
      updatedAt: server.updatedAt,
      syncState: 'synced',
    })
  }

  await tx.done
}
