/**
 * 画面の左端から始まるスワイプの見立て。
 *
 * 左袖（AppSidebar）を指で引き出すために使う（app/composables/useSidebarSwipe.ts）。
 * 触れた指の座標だけを見て「これは袖を引く動きか」「どこまで引かれたか」を
 * 決める。窓や DOM には触らないので、そのまま試せる。
 */

/** 触れている指のうち、判定に使うぶんだけ。実際の `Touch` もこの形を満たす。 */
export interface TouchPoint {
  identifier: number
  clientX: number
  clientY: number
}

/**
 * 端と見なす幅（px）。
 *
 * ここから始まったスワイプだけを袖の引き出しとして扱う。Android の
 * 「戻る」ジェスチャと同じくらいの幅にする。広く取ると、一覧の左端に
 * ある選択の四角（`ItemCard`）を押しづらくなる。
 */
export const EDGE_WIDTH = 24

/** ここまで引いて離せば開く（px）。届かなければ閉じたところへ戻す。 */
export const OPEN_THRESHOLD = 64

/**
 * 縦か横かを決めるまでの遊び（px）。
 *
 * 触れた直後の数 px で決めると、一覧を縦に送るつもりの指でも袖が
 * 顔を出してしまう。どちらへ動かしたいのかが分かるまで待つ。
 */
const SLOP = 8

/** 追いかけている1本の指。 */
export interface EdgeSwipe {
  /** どの指か。途中で別の指が触れても取り違えない。 */
  readonly pointer: number
  readonly startX: number
  readonly startY: number
  /** 横へ引いていると決まったか。決まるまでは袖を動かさない。 */
  horizontal: boolean
  /** 引いた距離（px）。まだ決まっていなければ 0。 */
  dragX: number
}

/**
 * 指の動きをどう扱うか。
 *
 * - `pending` … まだ縦横が決まっていない。袖は動かさず、既定の動きも止めない
 * - `dragging` … 袖を引いている。`dragX` まで出し、既定の動きは止める
 * - `cancelled` … 袖の引き出しではなかった（縦スクロールなど）。追うのをやめる
 */
export type EdgeSwipeMove = 'pending' | 'dragging' | 'cancelled'

/**
 * 端から始まった指なら追いかけ始める。端の外なら null（袖とは関係ない指）。
 */
export function beginEdgeSwipe(touch: TouchPoint): EdgeSwipe | null {
  if (touch.clientX > EDGE_WIDTH) return null
  return {
    pointer: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    horizontal: false,
    dragX: 0,
  }
}

/** 動いた指を当てはめ、袖をどこまで引くかを決める。 */
export function trackEdgeSwipe(swipe: EdgeSwipe, touch: TouchPoint): EdgeSwipeMove {
  const deltaX = touch.clientX - swipe.startX
  const deltaY = touch.clientY - swipe.startY

  if (!swipe.horizontal) {
    // どちらへ動かしたいのかが分かるまでは、何もしないで待つ
    if (Math.abs(deltaX) < SLOP && Math.abs(deltaY) < SLOP) return 'pending'
    // 縦の動きが勝っていれば一覧のスクロール。左へ戻す動きも袖ではない
    if (deltaX <= 0 || Math.abs(deltaY) >= Math.abs(deltaX)) return 'cancelled'
    swipe.horizontal = true
  }

  swipe.dragX = Math.max(0, deltaX)
  return 'dragging'
}

/** 離したときに開くか。ここまで引けていなければ閉じたところへ戻す。 */
export function opensSidebar(swipe: EdgeSwipe): boolean {
  return swipe.dragX >= OPEN_THRESHOLD
}
