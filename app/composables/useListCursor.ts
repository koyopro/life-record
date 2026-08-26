import type { MaybeRefOrGetter } from 'vue'

/**
 * 一覧のカーソル（`j` `k` / `↑` `↓`）。
 *
 * タスク一覧（`useItemList`）と検索結果（`app/pages/search.vue`）で同じ
 * 動き方にするために、ここに1つだけ置く。並びも中身も違う一覧なのに、
 * 送り方や折り返しがそれぞれ違うと、画面を移るたびに指が迷う。
 *
 * 持ち物は「いまどれを指しているか」だけ。選択（チェック）や操作の対象は
 * 一覧ごとに意味が変わるので、ここでは扱わない。
 */

/** カーソルが動ける行。id で見分けられれば何でもよい。 */
export interface CursorRow {
  id: string
}

interface Options<T extends CursorRow> {
  /**
   * 指していた行が一覧から消えたときの行き先。null を返せば先頭へ。
   *
   * タスク一覧では「消える前にその下にあったもの」へ移す
   * （`nextFocusAfterRemoval`）。省略すると先頭に戻る。
   */
  onMissing?: (before: T[], id: string, alive: Set<string>) => string | null
}

export function useListCursor<T extends CursorRow>(
  source: MaybeRefOrGetter<T[]>,
  options: Options<T> = {},
) {
  const rows = computed(() => toValue(source))

  /**
   * カーソルが指している行の id。
   *
   * 位置（index）ではなく id で持つ。重要度を変えるなどして並び順が
   * 変わったとき、位置で持っていると同じ位置が別の行を指してしまう。
   */
  const focusedId = ref<string | null>(null)

  /** 表示上のカーソル位置。focusedId から導く。 */
  const cursor = computed(() => {
    const index = rows.value.findIndex((row) => row.id === focusedId.value)
    return index >= 0 ? index : 0
  })

  const cursorRow = computed<T | null>(() => rows.value[cursor.value] ?? null)

  watch(
    rows,
    (list, previous) => {
      const alive = new Set(list.map((row) => row.id))

      if (focusedId.value === null) {
        // まだどれも指していなければ先頭を指す
        focusedId.value = list[0]?.id ?? null
        return
      }
      if (alive.has(focusedId.value)) return

      /*
       * 指していた行が一覧から消えたときの行き先は、一覧ごとに決める。
       * 位置は「消える前の一覧」（previous）から引く。いまの一覧にはもう
       * 無いので、消えた後の並びからでは下がどれか分からない。
       */
      focusedId.value =
        options.onMissing?.(previous ?? [], focusedId.value, alive) ??
        list[0]?.id ??
        null
    },
    { immediate: true },
  )

  /** 上下端まで来たら反対側へ折り返す。 */
  function moveCursor(delta: number) {
    const list = rows.value
    if (list.length === 0) return
    const next = (((cursor.value + delta) % list.length) + list.length) % list.length
    focusedId.value = list[next]?.id ?? null
  }

  /** その行へカーソルを移す。一覧に無い id なら何もしない。 */
  function focusRow(id: string) {
    if (rows.value.some((row) => row.id === id)) focusedId.value = id
  }

  /**
   * 行を並べている入れ物。カーソルが画面の外へ出ないよう送るのに使う。
   *
   * 呼ぶ側が `ref="listEl"` で結び、各行に `data-item-id` を振る。
   */
  const listEl = ref<HTMLElement | null>(null)

  /*
   * カーソルが動いたら、その行が見えるところまでスクロールする。
   * `j` / `k` で送っていると画面外へ出てしまい、どこを操作しているのか
   * 分からなくなるため。すでに見えているときは動かさない。
   */
  watch(
    () => cursorRow.value?.id,
    async (id) => {
      if (!id) return
      await nextTick()
      listEl.value
        ?.querySelector(`[data-item-id="${id}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    },
  )

  return { focusedId, cursor, cursorRow, moveCursor, focusRow, listEl }
}
