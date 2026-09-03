import type { Backlink } from '~~/shared/types/backlink'

/**
 * 「このページを指しているもの」の控え（docs/11-scrapbox-notation.md 11.11）。
 *
 * バックリンクはサーバーの部分一致検索から作るもので、手元では組み立て直せない
 * （docs/12-offline.md 12.9）。取りに行くたびに空から出すと、一度見た月へ
 * 戻るたびに「読み込み中…」が出る。**前回の内容を控えておき、再表示は
 * その場で出して、裏で取り直す。**
 *
 * 画面から切り離してここに置くのは、覚え方（何件まで・どれを捨てるか）を
 * テストできるようにするため。
 */

/** 覚えておくページ数。古いものから捨てる。 */
export const BACKLINK_REMEMBER_LIMIT = 12

/** 1ページぶんの控え。 */
export interface BacklinkEntry {
  path: string
  links: Backlink[]
}

/** 控えを引く。持っていなければ null（「0件」と区別する）。 */
export function findBacklinks(
  entries: BacklinkEntry[],
  path: string,
): Backlink[] | null {
  return entries.find((entry) => entry.path === path)?.links ?? null
}

/**
 * 取ってきた内容を控える。**新しいものを先頭**に置き、上限を超えた分を捨てる。
 *
 * 同じページを取り直したときは、古い方を残さず置き換える（同じパスの控えが
 * 2つあると、どちらを出すかで見え方が変わる）。
 */
export function rememberBacklinks(
  entries: BacklinkEntry[],
  path: string,
  links: Backlink[],
  limit: number = BACKLINK_REMEMBER_LIMIT,
): BacklinkEntry[] {
  const rest = entries.filter((entry) => entry.path !== path)
  return [{ path, links }, ...rest].slice(0, limit)
}

/**
 * localStorage の控えを、いま持っているものへ足す。
 *
 * サーバー描画で取れているページは、そちらのほうが新しい。控えで上書きせず、
 * **まだ持っていないページだけ**を後ろへ足す。
 */
export function mergeRemembered(
  current: BacklinkEntry[],
  stored: BacklinkEntry[],
  limit: number = BACKLINK_REMEMBER_LIMIT,
): BacklinkEntry[] {
  const known = new Set(current.map((entry) => entry.path))
  return [...current, ...stored.filter((entry) => !known.has(entry.path))].slice(0, limit)
}

/**
 * localStorage から読んだ控えを、使える形にして返す。
 *
 * 形が変わったあとの古い控えや、壊れた内容をそのまま画面へ渡さない
 * （出す側が `link.head.text` のような奥まで見るため、ここで弾く）。
 */
export function parseBacklinkEntries(raw: string): BacklinkEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  return parsed.filter((entry): entry is BacklinkEntry => {
    if (typeof entry !== 'object' || entry === null) return false
    const candidate = entry as { path?: unknown; links?: unknown }
    return typeof candidate.path === 'string' && Array.isArray(candidate.links)
  })
}
