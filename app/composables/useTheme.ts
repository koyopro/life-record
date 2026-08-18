/**
 * 見た目の明暗（テーマ）。
 *
 * 既定は端末の設定に従う（`system`）。ただし端末が暗い設定でも
 * 明るい表示で読みたいことがあるため、明示的に選べるようにする。
 * 選んだ結果は `<html data-theme>` に出し、色は CSS 側が決める
 * （app/assets/css/main.css）。
 */

export type ThemeMode = 'system' | 'light' | 'dark'

/** 保存先の鍵。切り替え前の一瞬の書き換え（nuxt.config.ts）と共有する */
export const THEME_STORAGE_KEY = 'theme'

/** 切り替えの順。押していけば元の状態へ戻れるようにする */
export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']

export const THEME_LABELS: Record<ThemeMode, string> = {
  system: '端末に合わせる',
  light: 'ライト',
  dark: 'ダーク',
}

function readMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    // プライベートブラウズなどで localStorage が使えない場合は既定のまま
  }
  return 'system'
}

function applyMode(mode: ThemeMode) {
  const root = document.documentElement
  // 「端末に合わせる」は属性を消す。CSS の既定（color-scheme: light dark）に戻す
  if (mode === 'system') delete root.dataset.theme
  else root.dataset.theme = mode

  try {
    if (mode === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // 保存できなくても、その場の表示は切り替わる
  }
}

export function useTheme() {
  // サーバー描画時は既定値。保存した設定はハイドレーション後に反映する
  // （初回の描画そのものは nuxt.config.ts の先読みが合わせている）
  const mode = useState<ThemeMode>('theme', () => 'system')
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')

  /** いま実際に見えている側 */
  const resolved = computed<'light' | 'dark'>(() => {
    if (mode.value === 'system') return prefersDark.value ? 'dark' : 'light'
    return mode.value
  })

  onMounted(() => {
    mode.value = readMode()
    watch(mode, applyMode)
  })

  /** 次のテーマへ切り替える */
  function cycle() {
    const next = (THEME_MODES.indexOf(mode.value) + 1) % THEME_MODES.length
    mode.value = THEME_MODES[next]!
  }

  return { mode, resolved, cycle }
}
