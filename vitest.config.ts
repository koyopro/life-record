import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * オフライン対応（IndexedDB と同期）のテスト。
 *
 * 対象は画面から切り離した層（app/utils/offline）なので、Nuxt を起こさずに
 * 素の環境で動かす。IndexedDB は fake-indexeddb で置き換える。
 */
export default defineConfig({
  test: {
    /*
     * アプリのタイムゾーン（Asia/Tokyo）で走らせる。
     *
     * 日付の解釈は2通りある。`toAppDate` などは Asia/Tokyo 固定だが、
     * SmartAdd の `^今日` は端末のタイムゾーンで解釈する（chrono）。
     * 実際の利用者の端末では両者が一致するので、テストでもそろえないと
     * 「日付が1日ずれる」だけの失敗が出る。
     */
    env: { TZ: 'Asia/Tokyo' },
    environment: 'happy-dom',
    include: ['tests/**/*.spec.ts'],
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
