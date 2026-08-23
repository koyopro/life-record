import { describe, expect, it } from 'vitest'
import { viewUrlCacheSeconds, viewUrlWindowStart } from '~~/server/utils/s3'

/**
 * 画像の表示用 URL（docs/03-functional-spec.md 3.5 / docs/07-open-questions.md Q4）。
 *
 * 署名付き URL は署名した時刻が入るので、毎回作ると同じ画像でも URL が変わり、
 * 一度読んだ画像が読み直しになる。署名の時刻を「窓」に丸めて、同じ窓の間は
 * 同じ URL になるようにしている。
 */

describe('viewUrlWindowStart', () => {
  it('同じ窓の中では、同じ時刻に丸まる', () => {
    const early = viewUrlWindowStart(new Date('2026-08-23T10:00:01.000Z'))
    const late = viewUrlWindowStart(new Date('2026-08-23T10:59:59.000Z'))

    expect(early.toISOString()).toBe('2026-08-23T10:00:00.000Z')
    expect(late.toISOString()).toBe(early.toISOString())
  })

  it('窓を越えたら、次の窓の頭になる', () => {
    expect(viewUrlWindowStart(new Date('2026-08-23T11:00:00.000Z')).toISOString()).toBe(
      '2026-08-23T11:00:00.000Z',
    )
  })
})

describe('viewUrlCacheSeconds', () => {
  it('窓の頭では、窓の長さそのもの', () => {
    expect(viewUrlCacheSeconds(new Date('2026-08-23T10:00:00.000Z'))).toBe(3600)
  })

  it('窓の終わりが近いほど短くなる（URL が変わったら訊き直してもらう）', () => {
    expect(viewUrlCacheSeconds(new Date('2026-08-23T10:59:30.000Z'))).toBe(30)
  })

  it('0 秒にはしない（キャッシュしない扱いにならないように）', () => {
    expect(viewUrlCacheSeconds(new Date('2026-08-23T10:59:59.900Z'))).toBe(1)
  })
})
