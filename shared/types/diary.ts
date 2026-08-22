import type { ItemDto, SectionDto } from './item'

/**
 * カレンダーベースの1日1ページの日記（docs/02-data-model.md 2.6）。
 * `date` が主キーなので、id は持たない。
 */
export interface DiaryDto {
  /** YYYY-MM-DD。 */
  date: string
  body: string
  /**
   * サーバーが最後に書き換えた時刻（ISO 8601）。まだ書かれていない日は null。
   *
   * 取得と保存は別々に飛ぶため、**保存より前に出した取得の応答が保存の後で
   * 届く**ことがある。届いた内容がこちらの保存を知っているかを判断できるよう、
   * サーバーの時計で打った時刻を返す（docs/15-client-state.md 14.2）。
   */
  updatedAt: string | null
}

export interface DiaryDetailDto extends DiaryDto {
  /**
   * サーバーがこの応答を作った時刻（ISO 8601）。
   *
   * 手元に残っている本文が、この応答より後に保存されたものかを判断する
   * ために持つ（docs/15-client-state.md 14.2）。
   */
  fetchedAt: string
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
  /**
   * その日の作業記録そのもの。
   *
   * 「この日にやったこと」は手元の作業記録から作る（docs/12-offline.md 12.4）
   * ので、他の端末で書かれた分もここで受け取って手元へ重ねる。
   */
  sections: DiarySectionDto[]
}

/** 日記から見た作業記録。Item をまたぐので、どの Item のものかを添える。 */
export interface DiarySectionDto extends SectionDto {
  itemId: string
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
