import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUpdateGate } from '~/utils/update-gate'

/**
 * アプリの更新を当てる時機（docs/12-offline.md 12.2）。
 *
 * 当てると画面を読み込み直すので、書いている途中に走らせない。
 * 書きかけが無くなり、そのまま静かなら当てる。
 */

function setup(quiet = 3_000) {
  let applied = 0
  const gate = createUpdateGate({ quiet, apply: () => void applied++ })
  return { gate, applied: () => applied }
}

describe('createUpdateGate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('書きかけが無ければ、少し置いてから当てる', () => {
    const { gate, applied } = setup()

    gate.ready()
    expect(applied()).toBe(0)

    vi.advanceTimersByTime(3_000)
    expect(applied()).toBe(1)
  })

  it('書きかけがあるうちは当てない。片付いてから当てる', () => {
    const { gate, applied } = setup()

    gate.setBusy(true)
    gate.ready()
    vi.advanceTimersByTime(60_000)
    expect(applied()).toBe(0)

    gate.setBusy(false)
    vi.advanceTimersByTime(3_000)
    expect(applied()).toBe(1)
  })

  it('数えている途中で書き始めたら、当てるのをやめる', () => {
    const { gate, applied } = setup()

    gate.ready()
    vi.advanceTimersByTime(2_000)
    gate.setBusy(true)
    vi.advanceTimersByTime(60_000)
    expect(applied()).toBe(0)
  })

  it('入力の切れ目で一瞬だけ手が空いても、そこでは当てない', () => {
    const { gate, applied } = setup()

    gate.ready()
    gate.setBusy(true)
    // 変換の確定・欄の移動などで、書きかけは一瞬だけ消える
    gate.setBusy(false)
    vi.advanceTimersByTime(500)
    gate.setBusy(true)

    vi.advanceTimersByTime(60_000)
    expect(applied()).toBe(0)
  })

  it('「いま更新」は、書きかけがあっても当てる', () => {
    const { gate, applied } = setup()

    gate.setBusy(true)
    gate.ready()
    gate.applyNow()
    expect(applied()).toBe(1)
  })

  it('二度は当てない', () => {
    const { gate, applied } = setup()

    gate.ready()
    vi.advanceTimersByTime(3_000)
    gate.applyNow()
    gate.setBusy(true)
    gate.setBusy(false)
    vi.advanceTimersByTime(60_000)

    expect(applied()).toBe(1)
  })

  it('止めたあとは当てない', () => {
    const { gate, applied } = setup()

    gate.ready()
    gate.stop()
    vi.advanceTimersByTime(60_000)
    expect(applied()).toBe(0)
  })
})
