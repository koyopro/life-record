/**
 * 自分で登録するアイコン（docs/11-scrapbox-notation.md 11.8）。
 *
 * 本文には `:name:` とだけ書き、表示のときに画像へ置き換える。
 * 絵文字（Unicode 文字）と違って文字そのものが無いため、書いた形のまま
 * 残しておき、登録されている名前だけが画像になる。
 *
 * 画像は本文中の画像と同じ仕組みで S3 に置き、`/images/<ID>.<拡張子>` を
 * 指す（docs/03-functional-spec.md 3.5）。アイコンのために別の置き場を
 * 作らない。
 */

/** 名前の長さの上限。長い名前は本文の中で読みにくく、打つのも手間になる。 */
export const ICON_NAME_MAX_LENGTH = 32

/**
 * 名前に使える文字。
 *
 * 絵文字のショートコード（`:smile:`）と同じ範囲にそろえる。`:` で挟んで
 * 探すため、空白や `:` を許すと本文のどこまでが名前なのか決められない。
 */
export const ICON_NAME_PATTERN = /^[a-z0-9_-]+$/

export interface IconDto {
  id: string
  name: string
  /** 画像のパス（`/images/<ID>.<拡張子>`）。 */
  path: string
}

/**
 * 入力を名前として整える。使えない場合は null。
 *
 * 前後の `:` は付いていても外す（`:hoge:` と書き写して登録できるように）。
 */
export function normalizeIconName(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/^:+/, '').replace(/:+$/, '')
  if (!trimmed) return null
  if (trimmed.length > ICON_NAME_MAX_LENGTH) return null
  if (!ICON_NAME_PATTERN.test(trimmed)) return null
  return trimmed
}

/** ファイル名から名前の候補を作る（`スタンプ 1.png` → `スタンプ_1` は不可なので null）。 */
export function iconNameFromFileName(fileName: string): string | null {
  return normalizeIconName(fileName.replace(/\.[^.]+$/, '').replace(/\s+/g, '_'))
}
