import { splitMemoInput, type Memo } from '~~/shared/types/memo'

/** 楽観的に追加した、まだサーバーに保存されていないメモ。 */
interface PendingMemo extends Memo {
  pending: true
}

export type DisplayMemo = Memo | PendingMemo

export function isPending(memo: DisplayMemo): memo is PendingMemo {
  return 'pending' in memo && memo.pending
}

let tempIdCounter = 0

export function useMemos() {
  const {
    data,
    pending: loading,
    error,
    refresh,
  } = useFetch<Memo[]>('/api/memos', {
    query: { status: 'inbox' },
    default: () => [],
  })

  /** 保存待ちのメモ。一覧の先頭に混ぜて表示する。 */
  const optimistic = useState<PendingMemo[]>('memos:optimistic', () => [])
  const submitError = useState<string | null>('memos:submit-error', () => null)

  const memos = computed<DisplayMemo[]>(() => [
    ...optimistic.value,
    ...(data.value ?? []),
  ])

  /**
   * メモを追加する。
   *
   * 送信完了を待たずに一覧へ反映し、失敗したら取り除いてエラーを出す
   * （docs/06-roadmap.md Milestone 2）。
   */
  async function addMemo(text: string): Promise<boolean> {
    const input = splitMemoInput(text)
    if (!input) return false

    submitError.value = null

    const tempId = `pending-${++tempIdCounter}`
    const now = new Date().toISOString()
    optimistic.value = [
      {
        id: tempId,
        title: input.title,
        body: input.body ?? null,
        status: 'inbox',
        createdAt: now,
        updatedAt: now,
        pending: true,
      },
      ...optimistic.value,
    ]

    try {
      await $fetch<Memo>('/api/memos', {
        method: 'POST',
        body: { text },
      })
      await refresh()
      return true
    } catch (e) {
      submitError.value = extractMessage(e, 'メモを保存できませんでした')
      return false
    } finally {
      optimistic.value = optimistic.value.filter((m) => m.id !== tempId)
    }
  }

  /** メモを削除する。失敗したら一覧を戻す。 */
  async function removeMemo(id: string): Promise<boolean> {
    const snapshot = data.value ?? []
    data.value = snapshot.filter((m) => m.id !== id)
    submitError.value = null

    try {
      await $fetch(`/api/memos/${id}`, { method: 'DELETE' })
      return true
    } catch (e) {
      data.value = snapshot
      submitError.value = extractMessage(e, 'メモを削除できませんでした')
      return false
    }
  }

  return {
    memos,
    loading,
    error,
    submitError,
    addMemo,
    removeMemo,
    refresh,
  }
}

function extractMessage(e: unknown, fallback: string): string {
  if (typeof e === 'object' && e !== null) {
    const data = (e as { data?: { statusMessage?: string } }).data
    if (data?.statusMessage) return data.statusMessage
  }
  return fallback
}
