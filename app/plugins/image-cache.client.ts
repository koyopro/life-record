import { startCachedImages } from '~/utils/cached-image'

/**
 * 一度見た画像を手元に持っておく（docs/11-scrapbox-notation.md 11.7）。
 *
 * 画面ごとに手を入れず、出てきた `<img>` をまとめて見張る。
 * ブラウザにしか無い仕組み（IndexedDB・MutationObserver）を使うので
 * クライアント側だけで動かす。
 */
export default defineNuxtPlugin(() => {
  startCachedImages()
})
