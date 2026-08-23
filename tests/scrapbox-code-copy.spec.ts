import { describe, expect, it } from 'vitest'
import { codeBodyOf, parseScrapbox } from '~~/shared/utils/scrapbox/parse'

/**
 * コードブロックの中身のコピー（docs/11-scrapbox-notation.md 11.6）。
 *
 * 貼り付け先で使えるよう、ブロックの基準までの字下げは落とし、中身の段付けは
 * そのまま残す。
 */

describe('codeBodyOf', () => {
  it('`code:` の次から、中身の行だけを繋ぐ', () => {
    const lines = parseScrapbox(
      ['code:hello.js', ' function hello() {', '   return 1', ' }', '外の行'].join('\n'),
    )

    expect(codeBodyOf(lines, 0)).toBe(['function hello() {', '  return 1', '}'].join('\n'))
  })

  it('箇条書きの中でも、ブロックの基準までの字下げは落とす', () => {
    const lines = parseScrapbox(
      ['メモ', ' code:a.sh', '  echo hi', '   echo deep'].join('\n'),
    )

    expect(codeBodyOf(lines, 1)).toBe(['echo hi', ' echo deep'].join('\n'))
  })

  it('中身の空行も残す', () => {
    const lines = parseScrapbox(['code:a.js', ' a', ' ', ' b'].join('\n'))

    expect(codeBodyOf(lines, 0)).toBe('a\n\nb')
  })

  it('中身が無ければ空', () => {
    expect(codeBodyOf(parseScrapbox('code:a.js'), 0)).toBe('')
  })

  it('コードブロック以外の行を渡しても空', () => {
    expect(codeBodyOf(parseScrapbox('ただの行\nつぎの行'), 0)).toBe('')
  })
})
