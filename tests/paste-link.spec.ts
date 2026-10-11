import { describe, expect, it } from 'vitest'
import { bracketPastedUrl } from '~/utils/paste-link'

/**
 * 空の行に棋譜の URL を貼ったら `[URL]` で囲む
 * （docs/11-scrapbox-notation.md 11.11「URL の貼り付け」）。
 */

const KIFU = 'https://kifu.tsumego.jp/e/uDnN5ihZv7x57KK4?move=11&region=tl16'

describe('bracketPastedUrl', () => {
  it('空の行に棋譜の URL を貼ったら角括弧で囲む', () => {
    expect(bracketPastedUrl(KIFU, '')).toBe(`[${KIFU}]`)
  })

  it('埋め込みにする他のホスト（kifu-lab.vercel.app）も囲む', () => {
    const url = 'https://kifu-lab.vercel.app/e/abc?move=3'
    expect(bracketPastedUrl(url, '')).toBe(`[${url}]`)
  })

  it('前後の空白・改行は落としてから囲む', () => {
    expect(bracketPastedUrl(` ${KIFU}\n`, '')).toBe(`[${KIFU}]`)
  })

  it('中身が空白だけの行も空の行とみなす', () => {
    expect(bracketPastedUrl(KIFU, '  ')).toBe(`[${KIFU}]`)
  })

  it('文字のある行に貼ったときは変えない', () => {
    expect(bracketPastedUrl(KIFU, '棋譜:')).toBeNull()
  })

  it('他のホストの URL は変えない', () => {
    expect(bracketPastedUrl('https://example.com/e/abc', '')).toBeNull()
    // よく似た名前の別のホストも変えない
    expect(bracketPastedUrl('https://kifu.tsumego.jp.example.com/e/abc', '')).toBeNull()
  })

  it('URL 以外の文字が混じっていたら変えない', () => {
    expect(bracketPastedUrl(`棋譜 ${KIFU}`, '')).toBeNull()
    expect(bracketPastedUrl(`${KIFU}\n${KIFU}`, '')).toBeNull()
  })
})
