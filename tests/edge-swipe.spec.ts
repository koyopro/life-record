import { describe, expect, it } from 'vitest'
import {
  EDGE_WIDTH,
  OPEN_THRESHOLD,
  beginEdgeSwipe,
  opensSidebar,
  trackEdgeSwipe,
  type TouchPoint,
} from '~/utils/edge-swipe'

/**
 * 画面の左端からのスワイプで左袖を引き出す判定
 * （app/composables/useSidebarSwipe.ts が窓のイベントをここへ渡す）。
 */

function touch(clientX: number, clientY: number, identifier = 1): TouchPoint {
  return { identifier, clientX, clientY }
}

/** 端から始めて、指を渡した位置まで動かす。 */
function swipeTo(x: number, y: number, startY = 100) {
  const swipe = beginEdgeSwipe(touch(2, startY))
  if (!swipe) throw new Error('端から始めたのに追いかけていない')
  const move = trackEdgeSwipe(swipe, touch(x, y))
  return { swipe, move }
}

describe('edge-swipe', () => {
  it('端から触れた指を追いかける', () => {
    const swipe = beginEdgeSwipe(touch(2, 100, 7))
    expect(swipe).not.toBeNull()
    expect(swipe?.pointer).toBe(7)
  })

  it('端の外から触れた指は追いかけない', () => {
    expect(beginEdgeSwipe(touch(EDGE_WIDTH + 1, 100))).toBeNull()
  })

  it('縦横が決まるまでは袖を動かさない', () => {
    const { swipe, move } = swipeTo(6, 102)
    expect(move).toBe('pending')
    expect(swipe.dragX).toBe(0)
  })

  it('右へ引けば、引いた分だけ袖を出す', () => {
    const { swipe, move } = swipeTo(90, 104)
    expect(move).toBe('dragging')
    expect(swipe.dragX).toBe(88)
  })

  it('縦の動きが勝っていれば一覧のスクロールとみなす', () => {
    expect(swipeTo(12, 160).move).toBe('cancelled')
  })

  it('左へ動かす指は袖の引き出しではない', () => {
    const swipe = beginEdgeSwipe(touch(20, 100))
    expect(swipe).not.toBeNull()
    expect(trackEdgeSwipe(swipe!, touch(2, 101))).toBe('cancelled')
  })

  it('一度横と決まれば、そのあと縦に揺れても引き続ける', () => {
    const { swipe } = swipeTo(90, 104)
    expect(trackEdgeSwipe(swipe, touch(120, 200))).toBe('dragging')
    expect(swipe.dragX).toBe(118)
  })

  it('しきい値まで引いて離せば開く', () => {
    expect(opensSidebar(swipeTo(2 + OPEN_THRESHOLD, 100).swipe)).toBe(true)
  })

  it('しきい値に届かなければ開かない', () => {
    expect(opensSidebar(swipeTo(2 + OPEN_THRESHOLD - 1, 100).swipe)).toBe(false)
  })
})
