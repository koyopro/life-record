/**
 * Scrapbox 記法の中間表現（docs/11-scrapbox-notation.md）。
 *
 * 記法 → AST → HTML の順に変換する。文字列置換だけで HTML を作ると、
 * 記法が組み合わさったとき（`[* 強調 [https://example.com リンク]]` など）に
 * 破綻するため、必ずこの中間表現を挟む。
 */

/** 行単位のブロック。 */
export type Block = QuoteBlock | CodeBlock | LineBlock | BlankBlock

export interface LineBlock {
  type: 'line'
  /** 行頭の空白の深さ。0 なら箇条書きではない。 */
  indent: number
  nodes: Inline[]
}

export interface QuoteBlock {
  type: 'quote'
  indent: number
  nodes: Inline[]
}

export interface CodeBlock {
  type: 'code'
  indent: number
  /** `code:` の後ろ。ファイル名または言語名。 */
  name: string
  /** 中身。行頭の共通インデントは取り除いてある。 */
  code: string
}

export interface BlankBlock {
  type: 'blank'
}

/** 行の中身。 */
export type Inline =
  | TextNode
  | CodeNode
  | DecorationNode
  | LinkNode
  | PageLinkNode
  | ImageNode
  | HashTagNode

export interface TextNode {
  type: 'text'
  value: string
}

/** バッククオートで囲まれたインラインコード。中身は解釈しない。 */
export interface CodeNode {
  type: 'code'
  value: string
}

/**
 * `[* 強調]` `[/ 斜体]` `[- 打ち消し]` などの文字装飾。
 *
 * Scrapbox では記号を組み合わせられる（`[-/*** ...]`）ため、
 * 種類ごとの真偽値と、`*` の個数（文字サイズ）を持つ。
 */
export interface DecorationNode {
  type: 'decoration'
  /** `*` の個数。0 なら文字サイズは変えない。 */
  level: number
  italic: boolean
  strike: boolean
  underline: boolean
  nodes: Inline[]
}

/** 外部リンク。 */
export interface LinkNode {
  type: 'link'
  href: string
  nodes: Inline[]
}

/** `[ページ名]`。このサービスでは今のところ遷移先を持たない。 */
export interface PageLinkNode {
  type: 'pageLink'
  title: string
}

export interface ImageNode {
  type: 'image'
  src: string
  /** `[[画像URL]]` の場合。横幅いっぱいに表示する。 */
  large: boolean
  /** 画像にリンクが付いている場合の遷移先。 */
  href?: string
}

export interface HashTagNode {
  type: 'hashtag'
  name: string
}
