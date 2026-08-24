/**
 * 本文の画像を拡大して見る（docs/11-scrapbox-notation.md 11.7）。
 *
 * 本文の中では高さで頭打ちにしているので、貼った画像（スクリーンショットが
 * 多い）は縮んで読めないことがある。Scrapbox と同じく、押したら画面いっぱいに
 * 出せるようにする。
 *
 * 出す場所は1つ（app.vue の ImageViewer）にして、どの画面の画像からでも
 * 同じ見え方にする。
 */
export interface ViewedImage {
  src: string
  alt: string
}

export function useImageViewer() {
  /** 拡大して見ている画像。見ていなければ null。 */
  const image = useState<ViewedImage | null>('image-viewer', () => null)

  function open(src: string, alt = ''): void {
    if (!src) return
    image.value = { src, alt }
  }

  function close(): void {
    image.value = null
  }

  return { image, open, close }
}
