import {
  beginEdgeSwipe,
  opensSidebar,
  trackEdgeSwipe,
  type EdgeSwipe,
  type TouchPoint,
} from '~/utils/edge-swipe'

/**
 * 画面の左端からのスワイプで左袖（AppSidebar）を引き出す。
 *
 * 狭い画面で袖を開く入口は左下の ☰（app.vue）だけだった。一覧を眺めながら
 * 別の一覧へ移りたいとき、そのたびに親指を左下まで下ろすことになる。
 * 端からのスワイプなら、いま指を置いている高さのまま引き出せる。
 *
 * 指の動きにそのまま袖を追わせる（`dragX`）。どこまで引けば開くのかが
 * 途中で分かり、途中でやめれば戻る。触れた瞬間に開ききる作りだと、
 * うっかり触れたのか自分で開いたのかが区別できない。
 *
 * 一覧を出している画面（`ItemListView`）からだけ呼ぶ。日記や詳細の本文では
 * 文字の選択と取り合いになるうえ、そこから戻りたい先は袖ではなく元の一覧
 * （`useListOrigin`）なので、端のスワイプを当てる意味が薄い。
 *
 * 引くかどうかの見立ては app/utils/edge-swipe.ts に置く。ここは指の座標を
 * 渡し、返ってきた見立てを袖と既定の動きに反映するだけにする。
 */
export function useSidebarSwipe() {
  const { open, docked, dragX, setOpen } = useSidebar()

  /** 追いかけている指。触れていなければ null。 */
  let swipe: EdgeSwipe | null = null

  function reset() {
    swipe = null
    dragX.value = null
  }

  /** 追いかけている指を探す。無ければ、この操作とは関係ない指。 */
  function find(list: TouchList): TouchPoint | null {
    if (!swipe) return null
    for (const touch of Array.from(list)) {
      if (touch.identifier === swipe.pointer) return touch
    }
    return null
  }

  function onTouchStart(event: TouchEvent) {
    if (swipe) return
    // 並べて置いている幅では袖はもう見えている。開いている間も引かない
    if (docked.value || open.value) return

    const touch = event.touches[0]
    if (!touch) return
    swipe = beginEdgeSwipe(touch)
  }

  function onTouchMove(event: TouchEvent) {
    const touch = find(event.touches)
    if (!swipe || !touch) return

    const move = trackEdgeSwipe(swipe, touch)
    if (move === 'pending') return
    if (move === 'cancelled') {
      reset()
      return
    }

    /*
     * 横へ引いている間は、ブラウザの既定の動き（横スクロール・端からの
     * 「戻る」）に取られないようにする。端から始まった指だけを見ているので、
     * 一覧の縦スクロールを止めてしまうことはない。
     */
    if (event.cancelable) event.preventDefault()
    dragX.value = swipe.dragX
  }

  function onTouchEnd(event: TouchEvent) {
    if (!swipe || !find(event.changedTouches)) return

    const opens = opensSidebar(swipe)
    reset()
    if (opens) setOpen(true)
  }

  function onTouchCancel(event: TouchEvent) {
    if (!swipe || !find(event.changedTouches)) return
    reset()
  }

  /*
   * 指は端（本文の外）から入ってくるので、一覧の要素ではなく窓で受ける。
   * touchmove は既定の動きを止めるため passive にしない。
   */
  onMounted(() => {
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    window.addEventListener('touchcancel', onTouchCancel)
  })

  onUnmounted(() => {
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('touchend', onTouchEnd)
    window.removeEventListener('touchcancel', onTouchCancel)
    // 引いている途中で画面を移ったときに、袖を出したままにしない
    reset()
  })
}
