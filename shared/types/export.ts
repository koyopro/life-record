import type { ItemDetailDto } from './item'
import type { TagColor } from './tag'

/**
 * 全データの書き出し（docs/05-operations.md 5.3）。
 *
 * **DB に入っているユーザーのデータをすべて含める。**サービスから離れられる
 * 状態を保つのが目的なので、片方だけ欠けていると「持ち出せた」ことにならない。
 * 取り込み直す口（`scripts/import-backup.ts`）もこの形を読む。
 *
 * 画像の実体だけはここに入らない。本文には `/images/...` のパスが残るので、
 * S3 のバケットごと別に複製する（5.2）。
 */
export interface ExportData {
  exportedAt: string
  /** タスク。作業記録（sections）とタグ名を含む。 */
  items: ItemDetailDto[]
  diaries: ExportedDiary[]
  /**
   * タグ。**色**と、どの Item にも付いていないタグを残すために持つ
   * （Item 側が持っているのは名前だけ）。
   */
  tags: ExportedTag[]
  /** 自分で登録したアイコン（docs/11-scrapbox-notation.md 11.8）。 */
  icons: ExportedIcon[]
}

export interface ExportedDiary {
  date: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface ExportedTag {
  id: string
  name: string
  color: TagColor | null
  createdAt: string
}

export interface ExportedIcon {
  id: string
  name: string
  path: string
  createdAt: string
}
