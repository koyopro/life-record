import { randomUUID } from 'node:crypto'
import { objectKeyFor, presignUpload } from '~~/server/utils/s3'
import {
  IMAGE_MAX_BYTES,
  extensionFor,
  type ImageUploadDto,
} from '~~/shared/types/image'

/**
 * 画像のアップロード先を発行する（docs/03-functional-spec.md 3.5）。
 *
 * 画像バイナリはこの Function を通さない。ブラウザが署名付き URL へ
 * 直接 PUT する。実行時間とペイロードの制限を避けるため。
 */
export default defineEventHandler(async (event): Promise<ImageUploadDto> => {
  const payload = await readBody<{ contentType?: unknown; size?: unknown }>(event)

  if (typeof payload?.contentType !== 'string') {
    throw createError({ statusCode: 400, message: '不正な種類です' })
  }

  const contentType = payload.contentType.toLowerCase()
  const extension = extensionFor(contentType)
  if (!extension) {
    throw createError({
      statusCode: 400,
      message: 'この形式の画像は扱えません',
    })
  }

  if (typeof payload.size === 'number' && payload.size > IMAGE_MAX_BYTES) {
    throw createError({
      statusCode: 400,
      message: `画像は ${Math.floor(IMAGE_MAX_BYTES / 1024 / 1024)}MB までです`,
    })
  }

  // 本文には `/images/<ID>.<拡張子>` を書く。オブジェクトキーもこれに
  // そろえるので、表示のときに対応表を引かずに解決できる。
  const fileName = `${randomUUID()}.${extension}`

  return {
    uploadUrl: await presignUpload(objectKeyFor(fileName), contentType),
    path: `/images/${fileName}`,
    contentType,
  }
})
