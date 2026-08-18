/**
 * OS の共有シートから受け取った内容を、Item の入力テキストに直す
 * （docs/13-share-target.md）。
 *
 * 共有元から来るのは `url` / `title` / `text` の3つで、どれが入るかは
 * アプリごとに違う。ここでは「1行目がタイトル、2行目以降が本文」という
 * 既存の入力の形（shared/utils/text.ts）に寄せるだけにする。組み立てた
 * テキストはそのまま SmartAdd に渡され、1行目の裸の URL は Item の
 * url 欄へ回る（shared/utils/smart-add.ts）。
 */

export interface SharedContent {
  url?: string
  title?: string
  text?: string
}

export interface ComposedShare {
  /** 入力欄に入れるテキスト。1行目がタイトル、2行目以降が本文。 */
  text: string
  /** Item の url 欄に入る URL。見つからなければ null。 */
  url: string | null
}

/** URL から作るタイトルの長さの上限。長い URL をそのまま並べても読めない。 */
const TITLE_FROM_URL_MAX = 120

/**
 * 共有された内容から入力テキストを組み立てる。
 *
 * タイトルは `title` → `text` の1行目 → URL の見出し の順に決める。
 * URL は必ず1行目に置き、SmartAdd がそこから url 欄へ移す。
 * 使い切らなかった `text` は本文として残す（共有元によっては本文にしか
 * 情報が無いため、捨てない）。
 */
export function composeShare(shared: SharedContent): ComposedShare {
  const givenTitle = (shared.title ?? '').trim()
  const text = normalize(shared.text ?? '')
  const url = pickUrl(shared.url, text)

  // text から URL を取り出したなら、本文に同じ URL を残さない。
  // url 欄と1行目に入るので、三度書くことになる
  const rest = url ? stripUrl(text, url) : text

  const fromText = rest ? firstLine(rest) : ''
  const title = givenTitle || fromText || titleFromUrl(url) || ''

  // タイトルに使った分を除いた残り。共有元がタイトルと同じ文字列を
  // text にも入れてくることがあるため、その場合も本文にしない
  const body = givenTitle
    ? rest === givenTitle
      ? ''
      : rest
    : afterFirstLine(rest)

  const titleLine = [title, url].filter(Boolean).join(' ')

  return {
    text: body ? `${titleLine}\n${body}` : titleLine,
    url,
  }
}

/** 共有として受け取れる内容が何かあるか。何も無ければ受付画面を出さない。 */
export function hasSharedContent(shared: SharedContent): boolean {
  return Boolean(
    (shared.url ?? '').trim() ||
      (shared.title ?? '').trim() ||
      (shared.text ?? '').trim(),
  )
}

/**
 * url 欄に入れる URL を決める。
 *
 * `url` が渡されなくても、`text` に URL が混ざっていることがある
 * （共有元が URL を text に入れて渡してくる場合）。
 */
function pickUrl(url: string | undefined, text: string): string | null {
  const explicit = (url ?? '').trim()
  if (/^https?:\/\/\S+$/i.test(explicit)) return explicit

  const found = /(?:^|\s)(https?:\/\/\S+)/.exec(text)
  return found?.[1] ?? null
}

/**
 * URL からタイトルを作る。
 *
 * `title` が来ない共有元でも、一覧で何の Item か分かるようにする。
 * ページのタイトルを取りに行くことはしない（共有はすぐ終わらせたい）。
 */
function titleFromUrl(url: string | null): string | null {
  if (!url) return null

  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return decodeURIComponent(`${parsed.host}${path}`).slice(0, TITLE_FROM_URL_MAX)
  } catch {
    return url.slice(0, TITLE_FROM_URL_MAX)
  }
}

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

function stripUrl(text: string, url: string): string {
  return text.split(url).join(' ').replace(/[ \t]+/g, ' ').trim()
}

function firstLine(text: string): string {
  return text.split('\n')[0]!.trim()
}

function afterFirstLine(text: string): string {
  const lineBreak = text.indexOf('\n')
  return lineBreak === -1 ? '' : text.slice(lineBreak + 1).trim()
}
