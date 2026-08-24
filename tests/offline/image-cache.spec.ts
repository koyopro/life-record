import { beforeEach, describe, expect, it } from 'vitest'
import {
  countCachedImages,
  pruneCachedImages,
  readCachedImage,
  saveCachedImage,
  IMAGE_CACHE_MAX_BYTES,
} from '~/utils/offline/image-cache'
import { openLocalDatabase } from '~/utils/offline/local-database'
import { resetLocalDatabase } from '../helpers'

/**
 * 一度見た画像の控え（docs/11-scrapbox-notation.md 11.7）。
 *
 * 画像は S3 にあり、出すまでに2往復かかる。中身を手元に置いておけば、
 * 次からは通信せずに出せる。消えても取り直せるので、一杯になったら
 * 古く使ったものから捨てる。
 */
function blobOf(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/png' })
}

async function setUsedAt(path: string, usedAt: string) {
  const db = await openLocalDatabase()
  const record = await db.get('images', path)
  await db.put('images', { ...record!, usedAt })
}

beforeEach(async () => {
  await resetLocalDatabase()
})

describe('画像の控え', () => {
  it('控えた画像を、そのまま読み出せる', async () => {
    await saveCachedImage('/images/a.png', blobOf(10))

    const blob = await readCachedImage('/images/a.png')
    expect(blob?.size).toBe(10)
  })

  it('控えていない画像は null（そのままネットワークから読む）', async () => {
    expect(await readCachedImage('/images/none.png')).toBeNull()
  })

  it('大きすぎる画像は控えない（1枚で置き場を埋めない）', async () => {
    await saveCachedImage('/images/big.png', blobOf(IMAGE_CACHE_MAX_BYTES + 1))
    expect(await countCachedImages()).toBe(0)
  })

  it('中身が空のものは控えない', async () => {
    await saveCachedImage('/images/empty.png', blobOf(0))
    expect(await countCachedImages()).toBe(0)
  })

  it('上限を超えたら、最後に使ったのが古いものから捨てる', async () => {
    await saveCachedImage('/images/old.png', blobOf(10))
    await setUsedAt('/images/old.png', '2026-01-01T00:00:00.000Z')
    await saveCachedImage('/images/middle.png', blobOf(10))
    await setUsedAt('/images/middle.png', '2026-06-01T00:00:00.000Z')
    await saveCachedImage('/images/new.png', blobOf(10))

    await pruneCachedImages(2)

    expect(await readCachedImage('/images/old.png')).toBeNull()
    expect(await readCachedImage('/images/middle.png')).not.toBeNull()
    expect(await readCachedImage('/images/new.png')).not.toBeNull()
  })

  it('同じ画像を控え直しても増えない', async () => {
    await saveCachedImage('/images/a.png', blobOf(10))
    await saveCachedImage('/images/a.png', blobOf(20))

    expect(await countCachedImages()).toBe(1)
    expect((await readCachedImage('/images/a.png'))?.size).toBe(20)
  })
})
