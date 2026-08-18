import { describe, expect, it } from 'vitest'
import { searchEmoji } from '~~/shared/utils/emoji'

/**
 * 本文エディタの絵文字候補（`:` で出す、docs/11-scrapbox-notation.md とは別枠）。
 *
 * 記法としては保存せず、選んだ時点で実際の絵文字に置き換えるため、
 * ここでは検索ロジック（ショートコードの前方一致・部分一致）だけ確かめる。
 */
describe('searchEmoji', () => {
  it('空のクエリでは、よく使うものを先頭から返す', () => {
    const result = searchEmoji('', 3)
    expect(result).toHaveLength(3)
    expect(result[0]!.char).toBe('😀')
  })

  it('ショートコードの前方一致を優先する', () => {
    const result = searchEmoji('fire')
    expect(result[0]).toMatchObject({ char: '🔥', name: 'fire' })
  })

  it('前方一致が無ければ部分一致・キーワードで探す', () => {
    const result = searchEmoji('泣く')
    expect(result.some((entry) => entry.char === '😭')).toBe(true)
  })

  it('該当が無ければ空配列を返す', () => {
    expect(searchEmoji('xyz123notanemoji')).toEqual([])
  })

  it('limit を超えない', () => {
    expect(searchEmoji('a', 2)).toHaveLength(2)
  })
})
