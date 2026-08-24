import {
  IMAGE_MAX_BYTES,
  extensionFor,
  type ImageUploadDto,
} from '~~/shared/types/image'
import { saveCachedImage } from '~/utils/offline/image-cache'

/**
 * 画像を S3 へ上げ、本文に書くパスを返す（docs/03-functional-spec.md 3.5）。
 *
 * 画像そのものはサーバーを経由せず、署名付き URL でブラウザから
 * S3 へ直接送る。
 */
export function useImageUpload() {
  /** 進行中の枚数。まとめて落としたときにまとめて数える。 */
  const uploading = ref(0)
  const errorMessage = ref<string | null>(null)

  async function upload(file: File): Promise<string | null> {
    if (!extensionFor(file.type)) {
      errorMessage.value = 'この形式の画像は扱えません'
      return null
    }
    if (file.size > IMAGE_MAX_BYTES) {
      errorMessage.value = `画像は ${Math.floor(IMAGE_MAX_BYTES / 1024 / 1024)}MB までです`
      return null
    }

    uploading.value += 1
    errorMessage.value = null

    try {
      const target = await $fetch<ImageUploadDto>('/api/images', {
        method: 'POST',
        body: { contentType: file.type, size: file.size },
      })

      // ここだけ $fetch を使わない。宛先は S3 で、本文をそのまま
      // 送りたいだけなので、余計な変換を挟まない fetch のほうが素直。
      const response = await fetch(target.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': target.contentType },
      })
      if (!response.ok) {
        throw new Error(`S3 への保存に失敗しました (${response.status})`)
      }

      /*
       * 上げた画像は、その場で控えておく（docs/11-scrapbox-notation.md 11.7）。
       * 中身は手元にあるので、S3 から読み直さずに済む。差し込んだ直後の
       * 表示にも、そのまま使える。
       */
      void saveCachedImage(target.path, file).catch(() => {
        // 控えられなくても、表示そのものは今までどおりできる
      })

      return target.path
    } catch (e) {
      errorMessage.value = extractMessage(e)
      return null
    } finally {
      uploading.value -= 1
    }
  }

  /** 落とされた・貼られたものから画像だけを取り出す。 */
  function imagesFrom(transfer: DataTransfer | null): File[] {
    if (!transfer) return []
    return [...transfer.files].filter((file) => file.type.startsWith('image/'))
  }

  return { uploading, errorMessage, upload, imagesFrom }
}

function extractMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const data = (e as { data?: { message?: string } }).data
    if (data?.message) return data.message
    const message = (e as { message?: string }).message
    if (message) return message
  }
  return '画像を追加できませんでした'
}
