/**
 * Scrapbox 記法の中間表現（docs/11-scrapbox-notation.md）。
 *
 * 記法 → AST → HTML の順に変換する。文字列置換だけで HTML を作ると、
 * 記法が組み合わさったとき（`[* 強調 [https://example.com リンク]]` など）に
 * 破綻するため、必ずこの中間表現を挟む。
 *
 * **1行 = 1要素** で持つ。カーソルのある行だけをテキストに戻すため、
 * 行と表示が1対1で対応している必要がある。
 */

export type Line = TextLine | QuoteLine | CodeHeaderLine | CodeBodyLine

interface LineBase {
  /** 行頭の空白の数。箇条書きの階層になる。 */
  indent: number
  /** 元の行そのまま。編集に切り替えるときに使う。 */
  raw: string
}

export interface TextLine extends LineBase {
  type: 'text'
  nodes: Inline[]
}

export interface QuoteLine extends LineBase {
  type: 'quote'
  nodes: Inline[]
}

/** `code:ファイル名` の行。 */
export interface CodeHeaderLine extends LineBase {
  type: 'codeHeader'
  name: string
}

/** コードブロックの中身の行。記法として解釈しない。 */
export interface CodeBodyLine extends LineBase {
  type: 'codeBody'
  /** 表示する内容。コードブロックの基準までインデントを詰めてある。 */
  text: string
  /** ブロックの最後の行か。見た目をまとめるために使う。 */
  last: boolean
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
