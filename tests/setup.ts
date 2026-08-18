// ブラウザの IndexedDB の代わり。テストごとに作り直せるようにする
import 'fake-indexeddb/auto'

// crypto.randomUUID は happy-dom には無い（操作IDの発行に使う）
if (!globalThis.crypto?.randomUUID) {
  const { webcrypto } = await import('node:crypto')
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
}
