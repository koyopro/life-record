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
