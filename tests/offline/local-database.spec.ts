import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DB_NAME,
  closeLocalDatabase,
  openLocalDatabase,
} from '~/utils/offline/local-database'
import { listOperations, nextOperation, removeOperation } from '~/utils/offline/sync-queue'
import { resetLocalDatabase } from '../helpers'

/**
 * 版を上げたときの移行。
 *
 * 未送信の操作（operations）だけはサーバーへ届いていない変更そのものなので、
 * 作り直しでは済まない。持ち越せていることを確かめる。
 */
describe('LocalDatabase の移行', () => {
  beforeEach(resetLocalDatabase)

  /** 版 1（seq を持たない、opId を主キーにしていた頃）の DB を作る。 */
  async function createLegacyDatabase(
    operations: { opId: string; createdAt: string; itemId: string }[],
  ): Promise<void> {
    const db = await openDB(DB_NAME, 1, {
      upgrade(database) {
        const items = database.createObjectStore('items', { keyPath: 'id' })
        items.createIndex('by-sync-state', 'syncState')

        const store = database.createObjectStore('operations', { keyPath: 'opId' })
        store.createIndex('by-op-id', 'opId', { unique: true })

        database.createObjectStore('conflicts', { keyPath: 'itemId' })
        database.createObjectStore('meta', { keyPath: 'key' })
      },
    })

    for (const operation of operations) {
      await db.put('operations', {
        opId: operation.opId,
        kind: 'patch',
        itemIds: [operation.itemId],
        payload: { id: operation.itemId, patch: { status: 'closed' }, baseUpdatedAt: null },
        createdAt: operation.createdAt,
        attempts: 0,
        nextAttemptAt: operation.createdAt,
        givenUp: false,
        lastError: null,
      })
    }

    db.close()
  }

  it('未送信の操作を、積んだ順（createdAt）のまま持ち越す', async () => {
    // 取り出しが opId 順になるよう、積んだ順とは逆の並びにしておく
    await createLegacyDatabase([
      { opId: 'a0000000-0000-4000-8000-000000000000', createdAt: '2026-08-19T02:00:00.000Z', itemId: '3件目' },
      { opId: 'b0000000-0000-4000-8000-000000000000', createdAt: '2026-08-19T00:00:00.000Z', itemId: '1件目' },
      { opId: 'c0000000-0000-4000-8000-000000000000', createdAt: '2026-08-19T01:00:00.000Z', itemId: '2件目' },
    ])
    await closeLocalDatabase()

    const stored = await openLocalDatabase().then(() => listOperations())

    expect(stored.map((operation) => operation.itemIds[0])).toEqual([
      '1件目',
      '2件目',
      '3件目',
    ])
    // 主キーが採番されている（列を流すには、消す宛先が決まっている必要がある）
    expect(stored.map((operation) => operation.seq)).toEqual([1, 2, 3])
  })

  /**
   * 手当てが入る前の版（2・3）で上げ終わっていた DB は、古い形のまま
   * 取り残されていた（版 1 から上げるときだけ作り直していたため）。
   * 実際にそうなった DB があり、送信の列が一度も流れないままになっていた。
   */
  it('古い形のまま新しい版になっていた DB も、作り直して流せるようにする', async () => {
    // 版 4 まで上がっているが、operations は opId を主キーにしたままのもの
    const legacy = await openDB(DB_NAME, 4, {
      upgrade(database) {
        const items = database.createObjectStore('items', { keyPath: 'id' })
        items.createIndex('by-sync-state', 'syncState')

        const operations = database.createObjectStore('operations', { keyPath: 'opId' })
        operations.createIndex('by-op-id', 'opId', { unique: true })

        database.createObjectStore('conflicts', { keyPath: 'itemId' })
        database.createObjectStore('meta', { keyPath: 'key' })

        const sections = database.createObjectStore('sections', { keyPath: 'id' })
        sections.createIndex('by-item', 'itemId')
        sections.createIndex('by-date', 'date')

        database.createObjectStore('diaries', { keyPath: 'date' })

        const images = database.createObjectStore('images', { keyPath: 'path' })
        images.createIndex('by-used-at', 'usedAt')
      },
    })
    await legacy.put('operations', {
      opId: 'a0000000-0000-4000-8000-000000000000',
      kind: 'patch',
      itemIds: ['取り残されていた変更'],
      payload: { id: 'a', patch: { status: 'closed' }, baseUpdatedAt: null },
      createdAt: '2026-08-19T00:00:00.000Z',
      attempts: 0,
      nextAttemptAt: '2026-08-19T00:00:00.000Z',
      givenUp: false,
      lastError: null,
    })
    legacy.close()
    await closeLocalDatabase()

    await openLocalDatabase()

    const head = await nextOperation()
    expect(head?.itemIds).toEqual(['取り残されていた変更'])
    // 消す宛先が決まる（決まらないと列が一度も流れない）
    await removeOperation(head!.seq)
    expect(await listOperations()).toEqual([])
  })

  it('持ち越した操作を、送ったあと消せる', async () => {
    await createLegacyDatabase([
      { opId: 'a0000000-0000-4000-8000-000000000000', createdAt: '2026-08-19T00:00:00.000Z', itemId: '1件目' },
      { opId: 'b0000000-0000-4000-8000-000000000000', createdAt: '2026-08-19T01:00:00.000Z', itemId: '2件目' },
    ])
    await closeLocalDatabase()
    await openLocalDatabase()

    const head = await nextOperation()
    expect(head?.itemIds).toEqual(['1件目'])

    await removeOperation(head!.seq)

    expect((await nextOperation())?.itemIds).toEqual(['2件目'])
  })
})
