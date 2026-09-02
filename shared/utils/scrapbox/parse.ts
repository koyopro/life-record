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
 * `:name:`（自分で登録したアイコン）。
 *
 * 使える文字は絵文字のショートコードと同じ範囲にそろえる
 * （shared/types/icon.ts の ICON_NAME_PATTERN）。
 */
const ICON_PATTERN = /^:([a-zA-Z0-9_-]+):/

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
 * `&` は目印（色を敷く）に割り当てている。Scrapbox 側でも UserCSS で
 * 同じ記号に同じ見た目を与えて使っていたため。
 */
const DECORATION_SYMBOLS = "!\"#%&'()*+,\\-./{|}<>_~"
const DECORATION_PATTERN = new RegExp(`^([${DECORATION_SYMBOLS}]+)\\s+([\\s\\S]+)$`)

/**
 * 区切りの罫線（Scrapbox と同じ、ハイフン4つ以上だけの行）。
 *
 * 3つ以下は取らない。文中の「---」のような書き方まで線になってしまうため。
 */
const RULE_PATTERN = /^-{4,}$/

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

    /*
     * 表（`table:名前`）。続く「1段以上深い行」がその表の行になる。
     *
     * 行はここでまとめて読む。桁の幅は**表の中の全行で同じ**でなければ
     * ならず（行ごとに決めると桁がそろわない）、そのためには先に全行を
     * 見る必要があるため。
     */
    if (rest.startsWith(TABLE_MARKER)) {
      lines.push({
        ...split(raw, indent + TABLE_MARKER.length),
        type: 'tableHeader',
        indent,
      })

      const rows: { raw: string; base: number }[] = []
      let next = i + 1
      while (next < rawLines.length) {
        const rowRaw = rawLines[next]!
        const rowIndent = indentOf(rowRaw)
        const rowRest = rowRaw.slice(rowIndent)
        // 空行は、表の基準の字下げ（見出し + 1）と同じ間だけ続きとみなす
        // （コードブロックと同じ扱い。docs/11-scrapbox-notation.md 11.6）
        const inTable = rowRest.trim() ? rowIndent > indent : rowIndent === indent + 1
        if (!inTable) break

        // 基準より深い字下げはセルの中身なので、そのまま残す
        rows.push({ raw: rowRaw, base: Math.min(indent + 1, rowIndent) })
        next += 1
      }

      const cells = rows.map((row) =>
        row.raw
          .slice(row.base)
          .split('\t')
          .map((cell) => parseInline(cell)),
      )
      const columns = columnWidths(cells)

      rows.forEach((row, index) => {
        lines.push({
          ...split(row.raw, row.base),
          type: 'tableRow',
          indent,
          cells: cells[index]!,
          columns,
          last: index === rows.length - 1,
        })
      })

      i = next - 1
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

    // ハイフンだけの行は区切りの罫線。中身は解釈しない
    if (RULE_PATTERN.test(rest)) {
      lines.push({ ...split(raw, indent), type: 'rule', indent })
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
const TABLE_MARKER = 'table:'

/**
 * 桁ごとの幅（全角を2・半角を1として数えた文字数）。
 *
 * 表示は等幅ではないので、これは**目安**でしかない。ただし表の中の全行が
 * 同じ値を使うため、目安が多少ずれても桁はそろう。入りきらないセルは
 * 折り返す（幅を content から決めると行ごとにずれるため、広げはしない）。
 */
function columnWidths(rows: Inline[][][]): number[] {
  const widths: number[] = []
  for (const cells of rows) {
    cells.forEach((cell, index) => {
      const width = displayWidth(inlineText(cell))
      widths[index] = Math.max(widths[index] ?? MIN_COLUMN_WIDTH, width)
    })
  }
  // 桁がいくら長くても、画面からはみ出させない（入りきらない分は折り返す）
  return widths.map((width) => Math.min(width, MAX_COLUMN_WIDTH))
}

/** 桁の幅の下限・上限（全角を2として数えた文字数）。 */
const MIN_COLUMN_WIDTH = 2
const MAX_COLUMN_WIDTH = 40

/**
 * 全角を2・半角を1として数えた文字数。
 *
 * 東アジアの文字（漢字・かな・全角記号）と絵文字を2つぶんとして数える。
 */
const WIDE_CHARACTER =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1FAFF}]/u

function displayWidth(text: string): number {
  let width = 0
  for (const char of text) width += WIDE_CHARACTER.test(char) ? 2 : 1
  return width
}

/**
 * セルの**見た目の文字**（記法を取り除いた中身）。桁の幅を数えるのに使う。
 *
 * 書いたままの文字数で数えると、リンク（`[URL 見出し]`）を含む桁だけが
 * 実際よりずっと広くなる。画像・アイコンは文字ではないので、目安として
 * 全角1文字ぶんの幅として数える。
 */
function inlineText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value
        case 'decoration':
        case 'link':
          return inlineText(node.nodes)
        case 'pageLink':
          return node.title
        case 'hashtag':
          return `#${node.name}`
        case 'image':
        case 'icon':
          return '　'
      }
    })
    .join('')
}

/** 行を、余白に置き換える行頭と中身に分ける。 */
function split(raw: string, at: number): { raw: string; prefix: string; content: string } {
  return { raw, prefix: raw.slice(0, at), content: raw.slice(at) }
}

/**
 * コードブロックの中身を、`code:` の行から取り出す。
 *
 * 行頭（ブロックの基準までの字下げ）は行の中身に入っていないので、そのまま
 * 繋ぐだけでよい（「行頭（prefix）と中身（content）」）。箇条書きの中に
 * 埋め込んだブロックでも、貼り付け先に余計な字下げが付かない。中身より
 * 深い字下げは中身の一部なので、そのまま残る。
 */
export function codeBodyOf(lines: Line[], index: number): string {
  const body: string[] = []
  for (let i = index + 1; i < lines.length; i++) {
    if (lines[i]!.type !== 'codeBody') break
    body.push(lines[i]!.content)
  }
  return body.join('\n')
}

/**
 * 続きの行へ引き継ぐ行頭。
 *
 * Scrapbox と同じく字下げを引き継ぐ。引用の `>` も引き継ぐ（複数行の引用は
 * 各行に `>` を書く記法のため）。`code:` と `table:` だけは、続きの行が
 * もう1つのブロックにならないよう落とし、代わりに中身と同じ基準の
 * 字下げ（+1）にする。そうしないと、空のまま `Enter` や `Delete` を
 * 押しただけでブロックを抜けてしまう（空行の判定を参照）。
 */
export function continuationPrefix(line: Line | null): string {
  const stripped = (line?.prefix ?? '').replace(/(?:code:|table:)$/, '')
  const header = line?.type === 'codeHeader' || line?.type === 'tableHeader'
  return header ? `${stripped} ` : stripped
}

/**
 * 改行したときに、行頭の字下げを外す行か。
 *
 * **字下げの空白しか無い行**（箇条書きの空の項目）で `Enter` を押したら、
 * その行の字下げをすべて外してから改行する。抜けた先の行にも引き継がない。
 * 深いところまで書いて次の話に移るとき、`Backspace` で1段ずつ戻さずに済む
 * （docs/11-scrapbox-notation.md 11.6）。
 *
 * 引用（`>`）・コードブロック・表の中は対象にしない。それらの空行はブロックの
 * 中身としてそのまま意味があり、抜けるための操作は別にある。
 *
 * @param content 入力欄のいまの中身（行頭は含まない）。
 */
export function dropsIndentOnEnter(line: Line | null, content: string): boolean {
  return line?.type === 'text' && line.indent > 0 && content === ''
}

/**
 * 入力欄の値を行へ分ける。複数行を貼り付けたときに使う。
 *
 * 1行目は編集していた行頭のまま、**2行目以降には続きの行頭を付ける**。
 * 付けないと、コードブロックや引用の中に貼ったときに1行目だけがその中に残り、
 * 続きは外へこぼれ出てしまう（行頭の字下げが所属を決めているため）。
 *
 * 貼り付けた文字列そのものの字下げは、行頭の後ろにそのまま残る
 * （コードの中の段付けを保つ）。
 */
export function linesFromInput(text: string, line: Line | null): string[] {
  const [first = '', ...rest] = text.split('\n')
  const next = continuationPrefix(line)
  return [(line?.prefix ?? '') + first, ...rest.map((value) => next + value)]
}

/**
 * 行頭を1段ぶん外す。
 *
 * 行頭は表示では余白なので、その先頭で `Backspace` を押したときに
 * 「1文字消す」では見た目が変わらないことがある（`>` の後ろの空白など）。
 * 意味の単位で外す。
 */
export function dropPrefixUnit(prefix: string): string {
  const marker = /(?:> ?|code:|table:)$/.exec(prefix)
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

    /*
     * `:name:` は自分で登録したアイコン（11.8）。
     *
     * ここでは形だけを見る。登録が無ければ描画側が書かれたままの文字を
     * 出すので、`12:30:45` のような普通の文章が壊れることはない。
     */
    if (char === ':') {
      const match = ICON_PATTERN.exec(input.slice(i))
      if (match) {
        flush()
        nodes.push({
          type: 'icon',
          name: match[1]!.toLowerCase(),
          raw: match[0],
        })
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
        highlight: false,
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
        highlight: symbols.includes('&'),
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

/**
 * 行の中の画像を、書かれた順に取り出す。
 *
 * カーソルを置いた行でも画像のぶんの高さを確保するために使う
 * （docs/11-scrapbox-notation.md 11.6「画像の行は高さを残す」）。
 */
export function imagesIn(line: Line): ImageNode[] {
  switch (line.type) {
    case 'text':
    case 'quote':
      return collectImages(line.nodes)
    // 表は桁ごとに中身を持つ。どの桁の画像も行の高さを決める
    case 'tableRow':
      return line.cells.flatMap((cell) => collectImages(cell))
    default:
      return []
  }
}

function collectImages(nodes: Inline[]): ImageNode[] {
  const found: ImageNode[] = []
  for (const node of nodes) {
    if (node.type === 'image') found.push(node)
    if (node.type === 'decoration' || node.type === 'link') {
      found.push(...collectImages(node.nodes))
    }
  }
  return found
}

function firstImageIn(nodes: Inline[]): ImageNode | null {
  return collectImages(nodes)[0] ?? null
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
