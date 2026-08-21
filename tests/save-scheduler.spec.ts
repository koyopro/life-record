import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSaveScheduler,
  extractSaveError,
  type SaveStatus,
} from '~/utils/save-scheduler'

/**
 * 保存の遅延送信（docs/15-client-state.md）。
 *
 * ストアは編集を打鍵のたびに受け取り、送信だけを遅らせる。途中の値を
 * 送らないこと・同じ鍵で追い越さないこと・失敗を握り潰さないことを確かめる。
 */

function setup(delay = 700) {
  const statuses = new Map<string, SaveStatus>()
  const seen: string[] = []
  const scheduler = createSaveScheduler({
    delay,
    savedIndicatorMs: 50,
    onStatus: (key, status) => {
      statuses.set(key, status)
      seen.push(`${key}:${status.state}`)
    },
  })
  return { scheduler, statuses, seen }
}

describe('createSaveScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('入力が止まってから送る。途中の値は送らない', async () => {
    const { scheduler, statuses } = setup()
    const sent: string[] = []

    scheduler.schedule('a', async () => void sent.push('あ'))
    scheduler.schedule('a', async () => void sent.push('あい'))
    scheduler.schedule('a', async () => void sent.push('あいう'))

    expect(statuses.get('a')?.state).toBe('pending')
    expect(sent).toEqual([])

    await vi.advanceTimersByTimeAsync(700)

    expect(sent).toEqual(['あいう'])
    expect(statuses.get('a')?.state).toBe('saved')
  })

  it('鍵が違えば互いに待たない', async () => {
    const { scheduler } = setup()
    const sent: string[] = []

    scheduler.schedule('a', async () => void sent.push('a'))
    scheduler.schedule('b', async () => void sent.push('b'))

    await vi.advanceTimersByTimeAsync(700)

    expect(sent.sort()).toEqual(['a', 'b'])
  })

  it('送信中に書かれた分は、送り終わってから続けて送る', async () => {
    const { scheduler } = setup()
    const sent: string[] = []
    let release: (() => void) | null = null

    scheduler.schedule('a', async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      sent.push('1回目')
    })

    await vi.advanceTimersByTimeAsync(700)
    // 1回目の往復中に書き足す
    scheduler.schedule('a', async () => void sent.push('2回目'))
    await vi.advanceTimersByTimeAsync(700)

    // まだ1回目が終わっていないので、追い越さない
    expect(sent).toEqual([])

    release?.()
    await vi.advanceTimersByTimeAsync(0)

    expect(sent).toEqual(['1回目', '2回目'])
  })

  it('flush すると待たずに送る', async () => {
    const { scheduler, statuses } = setup()
    const sent: string[] = []

    scheduler.schedule('a', async () => void sent.push('a'))
    await scheduler.flush('a')

    expect(sent).toEqual(['a'])
    expect(statuses.get('a')?.state).toBe('saved')
  })

  it('送るものが無ければ flush しても何も起きない', async () => {
    const { scheduler, seen } = setup()
    await scheduler.flush('a')
    expect(seen).toEqual([])
  })

  it('失敗は error として知らせ、握り潰さない', async () => {
    const { scheduler, statuses } = setup()

    scheduler.schedule('a', async () => {
      throw { data: { message: '本文は長すぎます' } }
    })
    await scheduler.flush('a')

    expect(statuses.get('a')).toEqual({
      state: 'error',
      error: '本文は長すぎます',
    })
  })

  it('失敗しても、次の編集は送る', async () => {
    const { scheduler, statuses } = setup()
    const sent: string[] = []

    scheduler.schedule('a', async () => {
      throw new Error('切れた')
    })
    await scheduler.flush('a')
    expect(statuses.get('a')?.state).toBe('error')

    scheduler.schedule('a', async () => void sent.push('やり直し'))
    await scheduler.flush('a')

    expect(sent).toEqual(['やり直し'])
    expect(statuses.get('a')?.state).toBe('saved')
  })

  it('送り終わるまで busy。終われば下がる', async () => {
    const { scheduler } = setup()

    scheduler.schedule('a', async () => {})
    // 待っている間も「まだ送れていない」に含める
    expect(scheduler.busy('a')).toBe(true)
    expect(scheduler.busyKeys()).toEqual(['a'])

    await scheduler.flush('a')

    expect(scheduler.busy('a')).toBe(false)
    expect(scheduler.busyKeys()).toEqual([])
  })

  it('flushAll は待っているものをすべて送る', async () => {
    const { scheduler } = setup()
    const sent: string[] = []

    scheduler.schedule('a', async () => void sent.push('a'))
    scheduler.schedule('b', async () => void sent.push('b'))
    await scheduler.flushAll()

    expect(sent.sort()).toEqual(['a', 'b'])
  })

  it('しばらくすると「保存しました」の表示は消える', async () => {
    const { scheduler, statuses } = setup()

    scheduler.schedule('a', async () => {})
    await scheduler.flush('a')
    expect(statuses.get('a')?.state).toBe('saved')

    await vi.advanceTimersByTimeAsync(50)
    expect(statuses.get('a')?.state).toBe('idle')
  })
})

describe('extractSaveError', () => {
  it('サーバーの message をそのまま出す', () => {
    expect(extractSaveError({ data: { message: '本文は長すぎます' } })).toBe(
      '本文は長すぎます',
    )
  })

  it('分からなければ既定の一行にする', () => {
    expect(extractSaveError(new Error('boom'))).toBe('保存に失敗しました')
  })
})
