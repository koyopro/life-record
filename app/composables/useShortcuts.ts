export interface Shortcut {
  /** 反応するキー。`KeyboardEvent.key` の値で書く。 */
  keys: string[]
  /** ヘルプ（`?`）での表示。省略時は keys[0] を使う。 */
  display?: string
  label: string
  group: string
  run: (event: KeyboardEvent) => void | Promise<void>
  /** 入力欄にフォーカスがあっても実行するか（Esc など）。 */
  allowInInput?: boolean
  /** Shift が押されていることを要求するか。 */
  shift?: boolean
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * 単一キーのショートカットを登録する（docs/08-todo-management.md 8.3）。
 *
 * ヘルプ（`?`）は、渡された定義そのものから生成する。
 * 実装とヘルプがずれないようにするため、一覧を別に持たない。
 */
export function useShortcuts(shortcuts: MaybeRefOrGetter<Shortcut[]>) {
  const list = computed(() => toValue(shortcuts))

  function onKeydown(event: KeyboardEvent) {
    // 修飾キーとの組み合わせはブラウザ標準の操作を邪魔しない
    if (event.metaKey || event.ctrlKey || event.altKey) return

    const typing = isTypingTarget(event.target)

    for (const shortcut of list.value) {
      if (!shortcut.keys.includes(event.key)) continue
      if (Boolean(shortcut.shift) !== event.shiftKey) continue
      if (typing && !shortcut.allowInInput) continue

      event.preventDefault()
      void shortcut.run(event)
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onUnmounted(() => window.removeEventListener('keydown', onKeydown))

  /** ヘルプ表示用に、グループごとにまとめたもの。 */
  const groups = computed(() => {
    const byGroup = new Map<string, Shortcut[]>()
    for (const shortcut of list.value) {
      const existing = byGroup.get(shortcut.group)
      if (existing) existing.push(shortcut)
      else byGroup.set(shortcut.group, [shortcut])
    }
    return [...byGroup].map(([name, items]) => ({ name, items }))
  })

  return { groups }
}

/** ヘルプでのキー表示。 */
export function shortcutDisplay(shortcut: Shortcut): string {
  if (shortcut.display) return shortcut.display
  const key = shortcut.keys[0] ?? ''
  return shortcut.shift ? `Shift + ${key}` : key
}
