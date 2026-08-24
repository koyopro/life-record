import { openLocalDatabase, type LocalImage } from './local-database'

/**
 * 一度見た画像の控え（docs/11-scrapbox-notation.md 11.7）。
 *
 * 画像は S3 にあり、出すまでに「リダイレクトを引く → S3 から読む」の2往復が
 * 要る。ブラウザの持っている分で済むこともあるが、署名付き URL は1時間ごとに
 * 変わり、アプリの WebView（macOS アプリ）では持ち越されないことがあるため、
 * 一度見た画像でも表示までの間ができる。
 *
 * 中身そのものを IndexedDB に置き、次からは通信せずに出す。
 * 消えても S3 から取り直せるので、置き場が一杯になったら古いものから捨てる。
 */

/**
 * 1枚で置き場を埋めてしまわないよう、これより大きい画像は控えない。
 * 大きい画像ほど読み込みが遅いという痛みは残るが、そのために他の何十枚もの
 * 控えを追い出すほうが割に合わない。
 */
export const IMAGE_CACHE_MAX_BYTES = 8 * 1024 * 1024

/** 控えておく枚数の上限。超えたら、最後に使ったのが古いものから捨てる。 */
export const IMAGE_CACHE_MAX_ENTRIES = 300

/**
 * 「最後に使った時刻」を書き直す間隔。
 *
 * 表示のたびに書くと、画面を開くだけで書き込みが何度も走る。捨てる順を
 * 決められればよいので、ざっくり分かれば足りる。
 */
const USED_AT_REFRESH_MS = 60 * 60 * 1000

/** 控えてある画像。無ければ null。 */
export async function readCachedImage(path: string): Promise<Blob | null> {
  const db = await openLocalDatabase()
  const record = await db.get('images', path)
  if (!record) return null

  void touch(record)
  return new Blob([record.bytes], { type: record.type })
}

/** 使ったことを控えに残す。捨てる順（古く使ったものから）を決めるため。 */
async function touch(record: LocalImage): Promise<void> {
  const last = new Date(record.usedAt).getTime()
  if (Number.isFinite(last) && Date.now() - last < USED_AT_REFRESH_MS) return

  try {
    const db = await openLocalDatabase()
    await db.put('images', { ...record, usedAt: new Date().toISOString() })
  } catch {
    // 控えの整理のためだけの書き込みなので、失敗しても表示には関わらない
  }
}

/**
 * 画像を控える。大きすぎるものは控えない。
 *
 * 置き場が足りない（QuotaExceededError）ときは、古いものを捨ててから
 * 諦める。控えられなくても表示そのものは今までどおりできる。
 */
export async function saveCachedImage(path: string, blob: Blob): Promise<void> {
  if (blob.size === 0 || blob.size > IMAGE_CACHE_MAX_BYTES) return

  const now = new Date().toISOString()
  const record: LocalImage = {
    path,
    bytes: await blob.arrayBuffer(),
    type: blob.type,
    size: blob.size,
    savedAt: now,
    usedAt: now,
  }

  const db = await openLocalDatabase()
  try {
    await db.put('images', record)
  } catch {
    await pruneCachedImages(IMAGE_CACHE_MAX_ENTRIES / 2)
    return
  }

  await pruneCachedImages(IMAGE_CACHE_MAX_ENTRIES)
}

/**
 * 控えを上限まで減らす。最後に使ったのが古いものから捨てる。
 *
 * 「よく見るものを残す」ではなく「最近見たものを残す」にする。日記や作業記録は
 * 上から順に読み返すものなので、直前に見たあたりがまた要る。
 */
export async function pruneCachedImages(limit: number): Promise<void> {
  const db = await openLocalDatabase()
  const excess = (await db.count('images')) - limit
  if (excess <= 0) return

  const transaction = db.transaction('images', 'readwrite')
  const index = transaction.store.index('by-used-at')

  let cursor = await index.openKeyCursor()
  for (let removed = 0; cursor && removed < excess; removed += 1) {
    await transaction.store.delete(cursor.primaryKey)
    cursor = await cursor.continue()
  }

  await transaction.done
}

/** 控えている枚数。テストと、様子を見るためだけに使う。 */
export async function countCachedImages(): Promise<number> {
  const db = await openLocalDatabase()
  return await db.count('images')
}
