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

/** 全行をまとめて描画する（読み取り専用の表示向け）。 */
export function renderScrapbox(input: string): string {
  return parseScrapbox(input)
    .map((line) => `<div class="${lineClass(line)}"${indentStyle(line)}>${renderLine(line)}</div>`)
    .join('')
}

/**
 * 1行分の中身を HTML にする。
 *
 * 行の外側（`div` と字下げ）は呼び出し側が組み立てる。カーソルのある行だけを
 * テキスト入力に差し替えるとき、外枠を共通にしておくと見た目がずれない。
 */
export function renderLine(line: Line): string {
  switch (line.type) {
    case 'codeHeader':
      // `code:` は行頭として余白に置き換えるので、ここではファイル名だけを出す
      return `<span class="sb-code__name">${escapeHtml(line.content) || '&nbsp;'}</span>`
    case 'codeBody':
      return `<code class="sb-code__text">${escapeHtml(line.content) || '&nbsp;'}</code>`
    case 'quote':
    case 'text': {
      const html = renderInline(line.nodes)
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
  return classes.join(' ')
}

/** 字下げは CSS 変数で渡す。数値なので属性に入れても安全。 */
export function indentStyle(line: Line): string {
  return line.indent > 0 ? ` style="--sb-indent:${line.indent}"` : ''
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
}

export function renderInline(nodes: Inline[]): string {
  return nodes.map(renderNode).join('')
}

function renderNode(node: Inline): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value)

    case 'code':
      return `<code class="sb-code-inline">${escapeHtml(node.value)}</code>`

    case 'decoration': {
      const inner = renderInline(node.nodes)
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
      const inner = renderInline(node.nodes)
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
        case 'codeHeader':
          return line.content.trim()
        case 'codeBody':
          return line.content.trim()
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
      }
    })
    .join('')
}
