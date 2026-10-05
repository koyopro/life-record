import type { Shortcut } from '~/composables/useShortcuts'

/** `j` / `k` 1回で送る量（px）。数行ぶん。 */
export const PAGE_SCROLL_STEP = 80

/**
 * 画面を縦に送る。
 *
 * 押しっぱなし（キーリピート）のときは、なめらかなスクロールにしない。
 * 前のアニメーションが終わる前に次が来て打ち消し合い、かえって
 * 引っかかって見えるため。
 */
export function scrollPage(direction: 1 | -1, event?: KeyboardEvent) {
  window.scrollBy({
    top: direction * PAGE_SCROLL_STEP,
    behavior: event?.repeat ? 'instant' : 'smooth',
  })
}

/**
 * 一覧を持たない画面（日記・タスクの単独表示）で、`j` / `k` で画面を送る
 * （docs/08-todo-management.md 8.4）。
 *
 * 一覧では同じキーがカーソルの移動なので、そちらと並ぶ画面では使わない。
 */
export function pageScrollShortcuts(): Shortcut[] {
  return [
    {
      keys: ['j'],
      label: '下へスクロール',
      group: '移動',
      run: (event) => scrollPage(1, event),
    },
    {
      keys: ['k'],
      label: '上へスクロール',
      group: '移動',
      run: (event) => scrollPage(-1, event),
    },
  ]
}
