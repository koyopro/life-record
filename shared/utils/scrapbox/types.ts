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

export type Line = TextLine | QuoteLine | CodeHeaderLine | CodeBodyLine | RuleLine

interface LineBase {
  /** 行頭の空白の数。箇条書きの階層になる。 */
  indent: number
  /** 元の行そのまま。 */
  raw: string
  /**
   * 行頭のうち、**表示では文字を出さず余白に置き換える**部分。
   *
   * 字下げの空白・引用の `>` ・`code:` など、行の種類を決めるだけで
   * 中身ではない部分がここに入る。編集中もこの部分は文字として見せず、
   * 表示と同じ幅の余白を入れる。そうしないと、カーソルの有無で
   * 文字の開始位置がずれる（docs/11-scrapbox-notation.md 11.6）。
   */
  prefix: string
  /** `prefix` を除いた行の中身。編集で直接さわるのはこちら。 */
  content: string
}

export interface TextLine extends LineBase {
  type: 'text'
  nodes: Inline[]
}

export interface QuoteLine extends LineBase {
  type: 'quote'
  nodes: Inline[]
}

/**
 * `----`（ハイフン4つ以上）だけの行。区切りの罫線として表示する。
 *
 * `content` は書かれたままのハイフン（カーソルを置けば元の文字を直せる）。
 * 中身を解釈しないので `nodes` は持たない。
 */
export interface RuleLine extends LineBase {
  type: 'rule'
}

/** `code:ファイル名` の行。`content` がファイル名にあたる。 */
export interface CodeHeaderLine extends LineBase {
  type: 'codeHeader'
}

/**
 * コードブロックの中身の行。記法として解釈しない。
 *
 * `content` はブロックの基準までインデントを詰めた中身。
 * それより深い字下げはコードの一部なので `content` に残す。
 */
export interface CodeBodyLine extends LineBase {
  type: 'codeBody'
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
  | IconNode

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

/**
 * `:name:` で書く、自分で登録したアイコン（docs/11-scrapbox-notation.md 11.8）。
 *
 * 登録されているかどうかは、記法を読む時点では分からない（一覧はサーバーに
 * ある）。ここでは形だけを見て取り、画像にするか文字のまま出すかは
 * 描画時に決める。そのため、書かれたままの文字列も持っておく。
 */
export interface IconNode {
  type: 'icon'
  /** 引くための名前（小文字）。 */
  name: string
  /** 書かれたままの `:Name:`。登録が無ければこれをそのまま出す。 */
  raw: string
}
