import type { ItemDto } from './item'

/**
 * カレンダーベースの1日1ページの日記（docs/02-data-model.md 2.6）。
 * `date` が主キーなので、id は持たない。
 */
export interface DiaryDto {
  /** YYYY-MM-DD。 */
  date: string
  body: string
}

export interface DiaryDetailDto extends DiaryDto {
  /**
   * まだ書かれていない日は false。
   * 空の状態で開けるようにするため、404 ではなくこれで表す。
   */
  exists: boolean
  /**
   * その日に作業した Item。同じ日付の Section から導出する
   * （docs/02-data-model.md 2.8）。
   */
  items: ItemDto[]
}

/** 一覧に出す1件分。本文は先頭だけを抜き出す。 */
export interface DiarySummaryDto {
  date: string
  /** 本文冒頭の抜粋（記法を除いたプレーンテキスト）。 */
  excerpt: string
  /** 本文に含まれる最初の画像。ないなら null。 */
  imageSrc: string | null
}

/** 一覧の抜粋に使う長さ。 */
export const DIARY_EXCERPT_LENGTH = 140
