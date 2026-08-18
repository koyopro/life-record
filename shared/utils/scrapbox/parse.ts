import type { Block, Inline } from './types'

/**
 * Scrapbox 記法のパーサ（docs/11-scrapbox-notation.md）。
 *
 * 記法は Scrapbox 公式ヘルプに合わせている。Markdown には寄せない。
 * 未対応の記法は、そのままのテキストとして扱う。
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
 * 文字装飾に使える記号（Scrapbox の文字装飾記法）。
 *
 * Scrapbox は `!"#%&'()*+,-./{|}<>_~` を受け付け、CSS クラスとして出力する。
 * このサービスでは意味を与えているものだけを解釈し、残りは無視する。
 */
const DECORATION_SYMBOLS = "!\"#%&'()*+,\\-./{|}<>_~"
const DECORATION_PATTERN = new RegExp(`^([${DECORATION_SYMBOLS}]+)\\s+([\\s\\S]+)$`)

const URL_PATTERN = /^https?:\/\/\S+$/i
const BARE_URL_PATTERN = /https?:\/\/[^\s\]]+/

export function parseScrapbox(input: string): Block[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const indent = indentOf(raw)
    const content = raw.slice(indent)

    if (!content.trim()) {
      blocks.push({ type: 'blank' })
      continue
    }

    // コードブロック: `code:名前` の次から、1段以上深い行が中身
    const codeMatch = /^code:(.*)$/.exec(content)
    if (codeMatch) {
      const body: string[] = []
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]!
        // 空行はコードブロックの一部として扱う（中身の空行を保つため）
        if (!next.trim()) {
          body.push('')
          j++
          continue
        }
        if (indentOf(next) <= indent) break
        body.push(next.slice(indent + 1))
        j++
      }
      // 末尾の空行はコードブロックの外に出す
      while (body.length > 0 && body.at(-1) === '') body.pop()

      blocks.push({
        type: 'code',
        indent,
        name: codeMatch[1]!.trim(),
        code: body.join('\n'),
      })
      i = i + body.length
      continue
    }

    // 引用: 行頭の `>`
    if (content.startsWith('>')) {
      blocks.push({
        type: 'quote',
        indent,
        nodes: parseInline(content.slice(1).replace(/^ /, '')),
      })
      continue
    }

    blocks.push({ type: 'line', indent, nodes: parseInline(content) })
  }

  return blocks
}

/**
 * 行頭の空白の数。タブも1段として数える。
 *
 * Scrapbox では行頭の空白が階層を表すため、保存時に正規化してはならない。
 */
function indentOf(line: string): number {
  let count = 0
  while (count < line.length) {
    const char = line[count]
    if (char !== ' ' && char !== '\t') break
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
      return [{ type: 'image', src: content, large: true }]
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
      return [{ type: 'image', src: a, large: false, href: b }]
    }
    if (isUrl(a) && isImage(b)) {
      return [{ type: 'image', src: b, large: false, href: a }]
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
    return [{ type: 'image', src: content, large: false }]
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
  return URL_PATTERN.test(value) || APP_IMAGE_PATH.test(value)
}

function isImage(value: string): boolean {
  if (APP_IMAGE_PATH.test(value)) return true
  if (!URL_PATTERN.test(value)) return false
  // Gyazo は拡張子なしでも画像を指す
  if (/^https?:\/\/(i\.)?gyazo\.com\//i.test(value)) return true
  return IMAGE_EXTENSIONS.test(value)
}
