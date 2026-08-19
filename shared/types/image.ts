/**
 * 本文に埋め込む画像（docs/11-scrapbox-notation.md 11.7）。
 *
 * 本文には `[/images/<ID>.<拡張子>]` と書く。ホスト名も有効期限も
 * 埋め込まないので、ドメインを変えても署名が切れても本文は生き続ける。
 */

/** 受け付ける画像の種類と、対応する拡張子。 */
export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
}

/**
 * 1枚あたりの上限。
 *
 * 署名付き URL では実際のサイズを縛れないため、これは投稿側の目安。
 * 桁違いのものを誤って上げないための歯止めとして置く。
 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** 本文に書くパス。この形以外は画像として扱わない。 */
export const IMAGE_PATH_PATTERN =
  /^\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{3,4}$/

export function extensionFor(contentType: string): string | null {
  return IMAGE_CONTENT_TYPES[contentType.toLowerCase()] ?? null
}

export interface ImageUploadDto {
  /** S3 へ直接 PUT する先。有効期限つき。 */
  uploadUrl: string
  /** 本文に書くパス（`/images/<ID>.<拡張子>`）。 */
  path: string
  /** PUT のときに送る Content-Type。署名に含まれるため変えられない。 */
  contentType: string
}
