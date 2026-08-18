import { parseScrapbox } from './parse'
import type { Block, Inline } from './types'

/** 字下げを持つブロック。箇条書きの入れ子を組むときに使う。 */
type IndentedBlock = Exclude<Block, { type: 'blank' }>

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

export function renderScrapbox(input: string): string {
  return renderBlocks(parseScrapbox(input))
}

export function renderBlocks(blocks: Block[]): string {
  const html: string[] = []

  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]!

    if (block.type === 'blank') {
      i++
      continue
    }

    // 続く引用行はひとつの枠にまとめる。
    // Scrapbox では各行に `>` を書くが、見た目は1つの引用として扱いたい。
    if (block.type === 'quote' && block.indent === 0) {
      const lines: string[] = []
      while (i < blocks.length) {
        const next = blocks[i]!
        if (next.type !== 'quote' || next.indent !== 0) break
        lines.push(`<span class="sb-quote__line">${renderInline(next.nodes)}</span>`)
        i++
      }
      html.push(`<blockquote class="sb-quote">${lines.join('')}</blockquote>`)
      continue
    }

    // 字下げされた行が続く範囲を、ひとまとまりの箇条書きとして扱う
    if (block.indent > 0) {
      const group: IndentedBlock[] = []
      while (i < blocks.length) {
        const next = blocks[i]!
        if (next.type === 'blank' || next.indent === 0) break
        group.push(next)
        i++
      }
      html.push(renderList(group, 1))
      continue
    }

    html.push(renderBlock(block))
    i++
  }

  return html.join('\n')
}

/**
 * 字下げの深さに応じて `<ul>` を入れ子にする。
 *
 * Scrapbox では行頭の空白の数がそのまま階層になる。
 */
function renderList(blocks: IndentedBlock[], depth: number): string {
  const items: string[] = []

  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]!
    const own = renderBlock(block)

    // 自分より深い行は、この項目の子として入れ子にする
    const children: IndentedBlock[] = []
    let j = i + 1
    while (j < blocks.length && blocks[j]!.indent > block.indent) {
      children.push(blocks[j]!)
      j++
    }

    const nested = children.length > 0 ? renderList(children, depth + 1) : ''
    items.push(`<li>${own}${nested}</li>`)
    i = j
  }

  return `<ul class="sb-list">${items.join('')}</ul>`
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'blank':
      return ''
    case 'code':
      return renderCode(block.name, block.code)
    case 'quote':
      return `<blockquote class="sb-quote">${renderInline(block.nodes)}</blockquote>`
    case 'line':
      return `<p class="sb-line">${renderInline(block.nodes)}</p>`
  }
}

function renderCode(name: string, code: string): string {
  const label = name
    ? `<figcaption class="sb-code__name">${escapeHtml(name)}</figcaption>`
    : ''
  return `<figure class="sb-code">${label}<pre><code>${escapeHtml(code)}</code></pre></figure>`
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
