import { parseScrapbox } from './parse'
import type { Inline, Line } from './types'

/**
 * AST から HTML を作る（docs/11-scrapbox-notation.md）。
 *
 * 入力はユーザーが書いたテキストなので、**必ず全てエスケープしてから**
 * 組み立てる。属性値に入る URL も、危険なスキームを弾く。
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!)
}

/**
 * 属性に入れてよい URL だけを通す。
 *
 * `javascript:` などのスキームを弾く。相対パスは自前の画像なので許可する。
 */
function safeUrl(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.startsWith('/')) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return null
}

/**
 * 描画のときだけ要る情報。
 *
 * `:name:`（自分で登録したアイコン）は、記法を読む時点では画像かどうかを
 * 決められない。登録の一覧はサーバーにあるので、描画する側から渡す
 * （docs/11-scrapbox-notation.md 11.8）。
 */
export interface RenderOptions {
  /** アイコンの名前 → 画像のパス。渡さなければ、書かれたままの文字を出す。 */
  icons?: Record<string, string>
}

/** 全行をまとめて描画する（読み取り専用の表示向け）。 */
export function renderScrapbox(input: string, options: RenderOptions = {}): string {
  return parseScrapbox(input)
    .map(
      (line) =>
        `<div class="${lineClass(line)}"${indentStyle(line)}>${renderLine(line, options)}</div>`,
    )
    .join('')
}

/**
 * 1行分の中身を HTML にする。
 *
 * 行の外側（`div` と字下げ）は呼び出し側が組み立てる。カーソルのある行だけを
 * テキスト入力に差し替えるとき、外枠を共通にしておくと見た目がずれない。
 */
export function renderLine(line: Line, options: RenderOptions = {}): string {
  switch (line.type) {
    case 'codeHeader':
      // `code:` は行頭として余白に置き換えるので、ここではファイル名だけを出す
      return `<span class="sb-code__name">${escapeHtml(line.content) || '&nbsp;'}</span>`
    case 'codeBody':
      return `<code class="sb-code__text">${escapeHtml(line.content) || '&nbsp;'}</code>`
    case 'rule':
      // ハイフンは線そのものになるので、文字としては出さない
      return '<hr class="sb-rule" />'
    case 'tableHeader':
      // `table:` は行頭として余白に置き換えるので、ここでは名前だけを出す
      return `<span class="sb-table__name">${escapeHtml(line.content) || '&nbsp;'}</span>`
    case 'tableRow':
      return line.cells
        .map(
          (cell) =>
            `<span class="sb-table__cell">${renderInline(cell, options) || '&nbsp;'}</span>`,
        )
        .join('')
    case 'quote':
    case 'text': {
      const html = renderInline(line.nodes, options)
      // 空行の高さを保つ
      return html || '&nbsp;'
    }
  }
}

/** 行の外枠に付けるクラス。 */
export function lineClass(line: Line): string {
  const classes = ['sb-line', `sb-line--${kebab(line.type)}`]
  if (line.indent > 0) classes.push('sb-line--indented')
  if (line.type === 'codeBody' && line.last) classes.push('sb-line--code-last')
  if (line.type === 'tableRow' && line.last) classes.push('sb-line--table-last')
  return classes.join(' ')
}

/** 字下げと桁の幅は CSS 変数で渡す。どちらも数値から作るので属性に入れても安全。 */
export function indentStyle(line: Line): string {
  const declarations = [
    line.indent > 0 ? `--sb-indent:${line.indent}` : '',
    tableColumns(line) ? `--sb-table-cols:${tableColumns(line)}` : '',
  ].filter(Boolean)

  return declarations.length ? ` style="${declarations.join(';')}"` : ''
}

/**
 * 表の行の桁割り（`grid-template-columns` の値）。表の行でなければ null。
 *
 * 幅は文字数の目安（全角=2・半角=1）から作る。表示は等幅ではないので
 * ぴったりにはならないが、**表の中の全行が同じ値を使う**ので桁はそろう。
 * `parse.ts` の columnWidths を参照。
 */
export function tableColumns(line: Line): string | null {
  if (line.type !== 'tableRow') return null
  /*
   * 上限だけを決めた桁（`minmax(0, …)`）にする。決め打ちの幅だけだと、
   * 狭い画面で表が入りきらないときにセルが枠からはみ出す。上限にしておけば、
   * 収まらないぶんは詰められて（中身は折り返して）枠の中に留まる。
   * 詰め方は幅と行数だけで決まるので、詰まっても行どうしの桁はそろう。
   */
  return line.columns
    .map((width) => `minmax(0, calc(${width} * 0.5em + 1.25rem))`)
    .join(' ')
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
}

export function renderInline(nodes: Inline[], options: RenderOptions = {}): string {
  return nodes.map((node) => renderNode(node, options)).join('')
}

function renderNode(node: Inline, options: RenderOptions): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value)

    case 'code':
      return `<code class="sb-code-inline">${escapeHtml(node.value)}</code>`

    case 'decoration': {
      const inner = renderInline(node.nodes, options)
      const classes = ['sb-deco']
      // Scrapbox は `*` の数で文字サイズが変わる。見出し記法はない。
      if (node.level > 0) classes.push(`sb-deco--level${Math.min(node.level, 6)}`)
      if (node.italic) classes.push('sb-deco--italic')
      if (node.strike) classes.push('sb-deco--strike')
      if (node.underline) classes.push('sb-deco--underline')
      return `<span class="${classes.join(' ')}">${inner}</span>`
    }

    case 'link': {
      const href = safeUrl(node.href)
      const inner = renderInline(node.nodes, options)
      if (!href) return inner
      // アプリ内のパス（/items/... /diary/...）は、同じタブの中の
      // ページ遷移として扱う。外部リンクと違い、新規タブを開くと
      // 一覧やタブが増えるだけで、日記とタスクを行き来する用途に合わない。
      if (href.startsWith('/')) {
        return `<a class="sb-link sb-link--internal" href="${escapeHtml(href)}">${inner}</a>`
      }
      return `<a class="sb-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
    }

    case 'pageLink':
      // ページの概念がまだないので、リンクにはせず印だけ付ける
      return `<span class="sb-page-link">${escapeHtml(node.title)}</span>`

    case 'image': {
      const src = safeUrl(node.src)
      if (!src) return escapeHtml(node.src)
      const classes = node.large ? 'sb-image sb-image--large' : 'sb-image'
      const img = `<img class="${classes}" src="${escapeHtml(src)}" alt="" loading="lazy" />`
      const href = node.href ? safeUrl(node.href) : null
      if (!href) return img
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${img}</a>`
    }

    case 'hashtag':
      return `<span class="sb-hashtag">#${escapeHtml(node.name)}</span>`

    case 'icon': {
      const src = options.icons?.[node.name]
      // 登録が無ければ書かれたままの文字を出す。`12:30:45` のような
      // 普通の文章を、記法として食べてしまわないため
      if (!src) return escapeHtml(node.raw)

      const safe = safeUrl(src)
      if (!safe) return escapeHtml(node.raw)
      return `<img class="sb-icon" src="${escapeHtml(safe)}" alt="${escapeHtml(node.raw)}" title="${escapeHtml(node.raw)}" loading="lazy" />`
    }
  }
}

/**
 * 記法を取り除いた読みやすい文字列にする。
 *
 * 一覧カードの抜粋など、装飾を出さずに中身だけ見せたい場所で使う。
 * `[* 見出し]` がそのまま見えていると読みにくいため。
 */
export function toPlainText(input: string): string {
  return parseScrapbox(input)
    .map((line) => {
      switch (line.type) {
        // コードブロックも、リストの中に埋め込まれていれば字下げを保つ
        case 'codeHeader':
        case 'codeBody':
          return `${' '.repeat(line.indent)}${line.content}`
        case 'quote':
        case 'text':
          return `${' '.repeat(line.indent)}${plainInline(line.nodes)}`
      }
    })
    .join('\n')
    .trim()
}

function plainInline(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value
        case 'decoration':
          return plainInline(node.nodes)
        case 'link':
          return plainInline(node.nodes)
        case 'pageLink':
          return node.title
        case 'image':
          return ''
        case 'hashtag':
          return `#${node.name}`
        // 抜粋では画像を出さないので、書かれたままの `:name:` を残す
        case 'icon':
          return node.raw
      }
    })
    .join('')
}
