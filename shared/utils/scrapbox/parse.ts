import type { Line, Inline, ImageNode } from './types'
import { isAppDate } from '../date'

/**
 * Scrapbox 記法のパーサ（docs/11-scrapbox-notation.md）。
 *
 * 記法は Scrapbox 公式ヘルプに合わせている。Markdown には寄せない。
 * 未対応の記法は、そのままのテキストとして扱う。
 *
 * **入力の1行が、必ず結果の1要素に対応する。** カーソルのある行だけを
 * テキスト表示に戻すため、行と表示がずれてはいけない。
 *
 * 各行は `prefix`（表示では余白に置き換える行頭）と `content`（中身）に
 * 分けて持つ。`prefix + content === raw` が常に成り立つ。
 */

/** 画像として扱う拡張子。 */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i

/**
 * このサービスの画像を指すパス（docs/11-scrapbox-notation.md 11.7）。
 *
 * Scrapbox の画像記法は `[画像URL]` なので、独自記法を作らずに
 * 「URL に見えるもの」で表す。ホスト名を本文に埋め込まないよう、
 * アプリからの相対パスにしている。
 */
const APP_IMAGE_PATH = /^\/images\//

/**
 * このサービスの Item 詳細を指すパス。
 *
 * 日記とタスクの本文で相互にリンクを書けるように、画像リンク
 * （`[/images/xxx]`）と同じ「角括弧＋アプリの相対パス」の雰囲気で表す
 * （docs/11-scrapbox-notation.md 11.7）。URL の入力欄・アドレスバーから
 * そのまま貼り付けられるよう、id 部分は UUID の形だけを見る。
 */
const APP_ITEM_PATH = /^\/items\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** このサービスの日記を指すパス。 */
const APP_DIARY_PATH = /^\/diary\/(\d{4}-\d{2}-\d{2})$/

function isAppDiaryPath(value: string): boolean {
  const match = APP_DIARY_PATH.exec(value)
  return match !== null && isAppDate(match[1])
}

/**
 * 文字装飾に使える記号（Scrapbox の文字装飾記法）。
 *
 * Scrapbox は `!"#%&'()*+,-./{|}<>_~` を受け付け、CSS クラスとして出力する。
 * このサービスでは意味を与えているものだけを解釈し、残りは無視する。
 */
const DECORATION_SYMBOLS = "!\"#%&'()*+,\\-./{|}<>_~"
const DECORATION_PATTERN = new RegExp(`^([${DECORATION_SYMBOLS}]+)\\s+([\\s\\S]+)$`)

const URL_PATTERN = /^https?:\/\/\S+$/i
const BARE_URL_PATTERN = /https?:\/\/[^\s\]]+/

export function parseScrapbox(input: string): Line[] {
  const rawLines = input.replace(/\r\n?/g, '\n').split('\n')
  const lines: Line[] = []

  /** コードブロックの中にいる間、その基準となる字下げ。 */
  let codeIndent: number | null = null

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!
    const indent = indentOf(raw)
    const rest = raw.slice(indent)

    // コードブロックの中: 基準より深い行が続く限り。空行は、ブロックの
    // 基準の字下げ（`code:` 行の字下げ + 1）と同じ間だけ続きとみなす。
    // 合わない空行は、そこでコードブロックを抜けたとみなす
    // （docs/11-scrapbox-notation.md 11.6、Delete キーでの解除に対応するため）
    if (codeIndent !== null) {
      const inBlock = rest.trim() ? indent > codeIndent : indent === codeIndent + 1
      if (inBlock) {
        const nextRaw = rawLines[i + 1]
        const nextRest = nextRaw !== undefined ? nextRaw.slice(indentOf(nextRaw)) : undefined
        const nextIsBody =
          nextRaw !== undefined &&
          (nextRest!.trim()
            ? indentOf(nextRaw) > codeIndent
            : indentOf(nextRaw) === codeIndent + 1)
        // 基準より深い字下げはコードの一部なので中身に残す
        const base = Math.min(codeIndent + 1, indent)
        lines.push({
          ...split(raw, base),
          type: 'codeBody',
          indent: codeIndent,
          last: !nextIsBody,
        })
        continue
      }
      codeIndent = null
    }

    if (rest.startsWith(CODE_MARKER)) {
      codeIndent = indent
      lines.push({
        ...split(raw, indent + CODE_MARKER.length),
        type: 'codeHeader',
        indent,
      })
      continue
    }

    // 引用の `>` と、それに続く空白ひとつまでが行頭
    const quote = /^> ?/.exec(rest)
    if (quote) {
      const line = split(raw, indent + quote[0].length)
      lines.push({
        ...line,
        type: 'quote',
        indent,
        nodes: parseInline(line.content),
      })
      continue
    }

    lines.push({
      ...split(raw, indent),
      type: 'text',
      indent,
      nodes: parseInline(rest),
    })
  }

  return lines
}

const CODE_MARKER = 'code:'

/** 行を、余白に置き換える行頭と中身に分ける。 */
function split(raw: string, at: number): { raw: string; prefix: string; content: string } {
  return { raw, prefix: raw.slice(0, at), content: raw.slice(at) }
}

/**
 * 行頭を1段ぶん外す。
 *
 * 行頭は表示では余白なので、その先頭で `Backspace` を押したときに
 * 「1文字消す」では見た目が変わらないことがある（`>` の後ろの空白など）。
 * 意味の単位で外す。
 */
export function dropPrefixUnit(prefix: string): string {
  const marker = /(?:> ?|code:)$/.exec(prefix)
  if (marker) return prefix.slice(0, -marker[0].length)
  return prefix.slice(0, -1)
}

/**
 * 行頭の空白の数。タブ・全角スペースも1段として数える。
 *
 * 全角スペースは、スマートフォンの日本語入力で変換候補を確定する際などに
 * 半角のつもりで入ってしまいやすいため、同じ字下げとして扱う。
 * Scrapbox では行頭の空白が階層を表すため、保存時に正規化してはならない。
 */
export function indentOf(line: string): number {
  let count = 0
  while (count < line.length) {
    const char = line[count]
    if (char !== ' ' && char !== '\t' && char !== '　') break
    count++
  }
  return count
}

export function parseInline(input: string): Inline[] {
  const nodes: Inline[] = []
  let buffer = ''

  const flush = () => {
    if (buffer) {
      nodes.push({ type: 'text', value: buffer })
      buffer = ''
    }
  }

  let i = 0
  while (i < input.length) {
    const char = input[i]!

    // インラインコード: バッククオートで囲む。中身は解釈しない。
    if (char === '`') {
      const end = input.indexOf('`', i + 1)
      if (end > i) {
        flush()
        nodes.push({ type: 'code', value: input.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (char === '[') {
      const bracket = readBracket(input, i)
      if (bracket) {
        flush()
        nodes.push(...classifyBracket(bracket.inner, bracket.double))
        i = bracket.end
        continue
      }
    }

    // ハッシュタグ: 空白区切りの `#タグ`
    if (char === '#' && (i === 0 || /\s/.test(input[i - 1]!))) {
      const match = /^#([^\s[\]#]+)/.exec(input.slice(i))
      if (match) {
        flush()
        nodes.push({ type: 'hashtag', name: match[1]! })
        i += match[0].length
        continue
      }
    }

    // 裸の URL もリンクにする
    if (char === 'h') {
      const match = BARE_URL_PATTERN.exec(input.slice(i))
      if (match && match.index === 0) {
        flush()
        nodes.push({
          type: 'link',
          href: match[0],
          nodes: [{ type: 'text', value: match[0] }],
        })
        i += match[0].length
        continue
      }
    }

    buffer += char
    i++
  }

  flush()
  return nodes
}

/**
 * `[` から対応する `]` までを取り出す。
 *
 * `[* 強調 [https://example.com リンク]]` のような入れ子があるため、
 * 深さを数えて対応する括弧を探す。
 */
function readBracket(
  input: string,
  start: number,
): { inner: string; end: number; double: boolean } | null {
  const double = input.startsWith('[[', start)
  const open = double ? start + 2 : start + 1

  let depth = 1
  let i = open
  while (i < input.length) {
    if (input[i] === '[') depth++
    else if (input[i] === ']') {
      depth--
      if (depth === 0) break
    }
    i++
  }
  if (depth !== 0) return null

  if (double) {
    // `[[...]]` は閉じ括弧も2つ必要
    if (input[i + 1] !== ']') return null
    return { inner: input.slice(open, i), end: i + 2, double: true }
  }
  return { inner: input.slice(open, i), end: i + 1, double: false }
}

/** 角括弧の中身が何を指しているかを判定する。 */
function classifyBracket(inner: string, double: boolean): Inline[] {
  const content = inner.trim()
  if (!content) return [{ type: 'text', value: double ? '[[]]' : '[]' }]

  if (double) {
    // `[[画像URL]]` は横幅いっぱいの画像、それ以外は強調
    if (isImage(content)) {
      return [{ type: 'image', src: normalizeImageSrc(content), large: true }]
    }
    return [
      {
        type: 'decoration',
        level: 1,
        italic: false,
        strike: false,
        underline: false,
        nodes: parseInline(content),
      },
    ]
  }

  // 文字装飾: `[* 強調]` `[/ 斜体]` `[-/*** ...]`
  const decoration = DECORATION_PATTERN.exec(content)
  if (decoration) {
    const symbols = decoration[1]!
    return [
      {
        type: 'decoration',
        level: (symbols.match(/\*/g) ?? []).length,
        italic: symbols.includes('/'),
        strike: symbols.includes('-'),
        underline: symbols.includes('_'),
        nodes: parseInline(decoration[2]!),
      },
    ]
  }

  const tokens = content.split(/\s+/)

  // `[リンク先URL 画像URL]` と、その逆順
  if (tokens.length === 2) {
    const [a, b] = tokens as [string, string]
    if (isImage(a) && isUrl(b)) {
      return [{ type: 'image', src: normalizeImageSrc(a), large: false, href: b }]
    }
    if (isUrl(a) && isImage(b)) {
      return [{ type: 'image', src: normalizeImageSrc(b), large: false, href: a }]
    }
  }

  // `[URL タイトル]` と `[タイトル URL]`
  if (tokens.length >= 2) {
    const first = tokens[0]!
    const last = tokens.at(-1)!
    if (isUrl(first)) {
      return [
        {
          type: 'link',
          href: first,
          nodes: parseInline(tokens.slice(1).join(' ')),
        },
      ]
    }
    if (isUrl(last)) {
      return [
        {
          type: 'link',
          href: last,
          nodes: parseInline(tokens.slice(0, -1).join(' ')),
        },
      ]
    }
  }

  if (isImage(content)) {
    return [{ type: 'image', src: normalizeImageSrc(content), large: false }]
  }
  if (isUrl(content)) {
    return [
      { type: 'link', href: content, nodes: [{ type: 'text', value: content }] },
    ]
  }

  // 残りはページリンク
  return [{ type: 'pageLink', title: content }]
}

function isUrl(value: string): boolean {
  return (
    URL_PATTERN.test(value) ||
    APP_IMAGE_PATH.test(value) ||
    APP_ITEM_PATH.test(value) ||
    isAppDiaryPath(value)
  )
}

/** 本文に含まれる最初の画像の src。ないなら null（日記一覧のプレビュー用）。 */
export function firstImageSrc(input: string): string | null {
  for (const line of parseScrapbox(input)) {
    if (line.type !== 'text' && line.type !== 'quote') continue
    const image = firstImageIn(line.nodes)
    if (image) return image.src
  }
  return null
}

function firstImageIn(nodes: Inline[]): ImageNode | null {
  for (const node of nodes) {
    if (node.type === 'image') return node
    if (node.type === 'decoration' || node.type === 'link') {
      const found = firstImageIn(node.nodes)
      if (found) return found
    }
  }
  return null
}

/** Gyazo の共有ページ（`gyazo.com/<id>`）・画像ID（`i.gyazo.com/<id>`）の URL。 */
const GYAZO_URL_PATTERN = /^https?:\/\/(?:i\.)?gyazo\.com\/([0-9a-f]{32})(\.[a-z0-9]+)?(?:\?.*)?$/i

function isImage(value: string): boolean {
  if (APP_IMAGE_PATH.test(value)) return true
  if (!URL_PATTERN.test(value)) return false
  // Gyazo は拡張子なしでも画像を指す
  if (GYAZO_URL_PATTERN.test(value)) return true
  return IMAGE_EXTENSIONS.test(value)
}

/**
 * Gyazo の共有ページ URL を、実体画像の URL に直す。
 *
 * `gyazo.com/<id>` はHTMLページで、画像そのものは `i.gyazo.com/<id>.<拡張子>` にある。
 * 拡張子は共有ページからは分からないため、Gyazo の既定形式である png を仮定する。
 */
function normalizeImageSrc(value: string): string {
  const match = GYAZO_URL_PATTERN.exec(value)
  if (!match) return value
  const [, id, extension] = match
  return `https://i.gyazo.com/${id}${extension ?? '.png'}`
}
