import { describe, expect, it } from 'vitest'
import { isItemLinkDrag, readItemLinkDrag, startItemLinkDrag } from '~/utils/item-drag'

/**
 * 日記の「この日にやったこと」から本文へのドラッグ＆ドロップで使う
 * データの受け渡し（本文側は ScrapboxEditor.vue が読む）。
 */

/** 実際の DataTransfer の代わり。setData/getData/types だけ再現する。 */
function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    get types() {
      return [...store.keys()]
    },
  } as unknown as DataTransfer
}

describe('item-drag', () => {
  it('積んだものをそのまま読み出せる', () => {
    const dataTransfer = fakeDataTransfer()
    startItemLinkDrag({ dataTransfer } as unknown as DragEvent, {
      id: 'item-1',
      title: '買い物',
    })

    expect(isItemLinkDrag(dataTransfer)).toBe(true)
    expect(readItemLinkDrag(dataTransfer)).toEqual({ id: 'item-1', title: '買い物' })
  })

  it('別由来のドラッグ（データが無い）は null を返す', () => {
    const dataTransfer = fakeDataTransfer()
    expect(isItemLinkDrag(dataTransfer)).toBe(false)
    expect(readItemLinkDrag(dataTransfer)).toBeNull()
  })

  it('壊れた JSON は null を返す', () => {
    const dataTransfer = fakeDataTransfer()
    dataTransfer.setData('application/x-datalake-item-link', '{not json')
    expect(readItemLinkDrag(dataTransfer)).toBeNull()
  })

  it('dataTransfer が無ければ何も起きない', () => {
    expect(isItemLinkDrag(null)).toBe(false)
    expect(readItemLinkDrag(null)).toBeNull()
  })
})
