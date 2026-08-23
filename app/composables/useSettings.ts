import type { SettingsDto } from '~~/shared/types/setting'

/**
 * 画面の設定（一覧の並び・グループ順）の唯一の入口。
 *
 * 正本はサーバー（docs/15-client-state.md 14.7）。ブラウザに閉じていると
 * 端末を変えるたびに見え方が変わってしまうため、選んだ内容はサーバーへ送る。
 *
 * localStorage は**届くまで**と**オフライン**のための控えで、鍵はサーバーと
 * 同じ名前をそのまま使う。以前からブラウザに残っている値もそのまま拾えるので、
 * 移し替えは要らない（次に選び直したときにサーバーへ載る）。
 */

/** 送れていない変更。画面をまたいで残したいのでモジュールに置く。 */
const unsent = new Map<string, string>()

/** まとめて送るための待ち合わせ。続けて選び直しても1回にする。 */
let saveTimer: ReturnType<typeof setTimeout> | null = null
const SAVE_DELAY_MS = 400

function readRemembered(key: string): string | null {
  if (!import.meta.client) return null
  try {
    return localStorage.getItem(key)
  } catch {
    // 読めない環境（プライベートブラウズなど）では、サーバーが届くまで既定のまま
    return null
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 書けなくても、その回の見え方は変わらない
  }
}

/** 送れていない分をまとめて送る。送れなければ列に残し、次の機会に送り直す。 */
async function flush(): Promise<void> {
  saveTimer = null
  if (unsent.size === 0) return

  const body = Object.fromEntries(unsent)
  try {
    await $fetch<SettingsDto>('/api/settings', { method: 'PUT', body })
  } catch {
    // オフラインなど。控えには残っているので、この端末の見え方は変わらない
    return
  }

  // 送っている間にまた選び直したものは残す
  for (const [key, value] of Object.entries(body)) {
    if (unsent.get(key) === value) unsent.delete(key)
  }
}

/**
 * 繋がり直したときに、送れていない設定を送り直す。起動時に1度だけ呼ぶ。
 *
 * 画面の中で仕掛けると、その画面を離れた時点で外れてしまうため、
 * オフラインの見張り（`watchBrowserOnline`）と同じくプラグインから呼ぶ。
 */
export function watchSettingsRetry(): void {
  if (!import.meta.client) return

  const { online } = useOnline()
  watch(online, (value) => {
    if (value && unsent.size > 0) void flush()
  })
}

export function useSettings() {
  const { data } = useFetch<SettingsDto>('/api/settings', {
    key: 'settings',
    default: () => ({}),
  })

  /**
   * このブラウザで選び直した値。
   *
   * サーバーの応答より必ず新しい（送っている最中の応答には入っていない）ので、
   * 届いた内容より優先する。そうしないと、選んだ直後に前の値へ戻る。
   */
  const changed = useState<SettingsDto>('settings:changed', () => ({}))

  /** サーバーが持っていると分かっている値。控え（localStorage）は含まない。 */
  function saved(key: string): string | null {
    return changed.value[key] ?? data.value?.[key] ?? null
  }

  /**
   * 設定を1つ追う。
   *
   * 値は「控え → サーバー」の順に届くので、届くたびに `apply` を呼ぶ。
   * 最初の読み取りを onMounted で行うのは、控えがブラウザにしか無いため
   * （サーバー描画の結果と食い違わせない）。
   */
  function track(key: string, apply: (value: string) => void): void {
    onMounted(() => {
      const value = saved(key) ?? readRemembered(key)
      if (value !== null) apply(value)
    })

    // 別のブラウザで選び直した内容は、次の取得で届く
    watch(
      () => data.value?.[key],
      (value) => {
        if (value === undefined || changed.value[key] !== undefined) return
        apply(value)
      },
    )
  }

  /**
   * 設定を1つ保存する。
   *
   * サーバーの応答は待たない。控えとこの場の状態はすぐ更新し、送信だけ遅らせる
   * （docs/15-client-state.md 14.2 の3と同じ考え方）。
   */
  function set(key: string, value: string): void {
    if (!import.meta.client) return
    // 追ってきた値をそのまま書き戻すだけのときは、送るものが無い
    if (saved(key) === value) return

    changed.value = { ...changed.value, [key]: value }
    remember(key, value)

    unsent.set(key, value)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }

  return { track, set }
}
