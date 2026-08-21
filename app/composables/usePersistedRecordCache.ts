/**
 * Item本文（Section）・日記のように、IndexedDB に永続キャッシュを
 * 持たない画面の「直近見た内容」を localStorage に控えておく。
 *
 * 正本は常にサーバー。ここに入れるのはあくまで、取得が終わるまでの
 * 初期表示に使う控え（docs/12-offline.md 12.9）。`useState` によるセッション内
 * キャッシュだけではリロードのたびに空へ戻ってしまうため、localStorage にも
 * 書き戻し、リロード直後から直近の内容をすぐ出せるようにする。
 */

/** 際限なく増えないよう、直近に触れた分だけ残す件数。 */
const MAX_ENTRIES = 30

function storageKeyOf(name: string): string {
  return `datalake:cache:${name}`
}

function readFromStorage<T>(storageKey: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, T>
  } catch {
    // 壊れたデータや、プライベートブラウズなどで読めない場合は空のまま
    return {}
  }
}

function writeToStorage<T>(storageKey: string, value: Record<string, T>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // 保存できなくても、その場の表示は変わらない
  }
}

/**
 * localStorage への書き戻しは間引く。
 *
 * ストアは編集を打鍵のたびに受け取る（docs/15-client-state.md）ので、
 * そのつど JSON へ直して書くと入力が重くなる。画面に出るのはメモリ上の値
 * なので、書き戻しが少し遅れても見え方は変わらない。
 */
const WRITE_DELAY_MS = 500
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleWrite<T>(storageKey: string, value: Record<string, T>) {
  const timer = writeTimers.get(storageKey)
  if (timer) clearTimeout(timer)
  writeTimers.set(
    storageKey,
    setTimeout(() => {
      writeTimers.delete(storageKey)
      writeToStorage(storageKey, value)
    }, WRITE_DELAY_MS),
  )
}

export function usePersistedRecordCache<T>(name: string) {
  const storageKey = storageKeyOf(name)
  const cache = useState<Record<string, T>>(name, () => ({}))

  onMounted(() => {
    // サーバー描画時点の値（空、またはこの回の取得で既に入った分）を優先し、
    // 前回までの控えはまだ無い鍵の分だけ補う
    const stored = readFromStorage<T>(storageKey)
    cache.value = { ...stored, ...cache.value }
  })

  /** 値を控える。直近に触れた鍵ほど後ろに残るようにし、古いものから捨てる。 */
  function set(key: string, value: T) {
    const next = { ...cache.value }
    delete next[key]
    next[key] = value

    const keys = Object.keys(next)
    while (keys.length > MAX_ENTRIES) {
      const oldest = keys.shift()
      if (oldest !== undefined) delete next[oldest]
    }

    cache.value = next
    if (import.meta.client) scheduleWrite(storageKey, next)
  }

  return { cache, set }
}
