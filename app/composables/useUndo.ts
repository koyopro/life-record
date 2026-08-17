export interface UndoEntry {
  /** 「3件を完了にした」など、取り消し対象を説明する文言。 */
  label: string
  /** 実行すると元の状態に戻す処理。 */
  revert: () => Promise<void>
}

const MAX_DEPTH = 20

/**
 * 直前の操作を取り消すためのスタック（docs/08-todo-management.md 8.3）。
 *
 * 破壊的操作は必ずここに積み、`u` で戻せるようにする。
 */
export function useUndo() {
  const stack = useState<UndoEntry[]>('undo:stack', () => [])

  function push(entry: UndoEntry) {
    stack.value = [...stack.value.slice(-(MAX_DEPTH - 1)), entry]
  }

  /** 直前の操作を取り消す。取り消した内容の説明を返す。 */
  async function undo(): Promise<string | null> {
    const entry = stack.value.at(-1)
    if (!entry) return null

    stack.value = stack.value.slice(0, -1)
    await entry.revert()
    return entry.label
  }

  function clear() {
    stack.value = []
  }

  return {
    canUndo: computed(() => stack.value.length > 0),
    lastLabel: computed(() => stack.value.at(-1)?.label ?? null),
    push,
    undo,
    clear,
  }
}
